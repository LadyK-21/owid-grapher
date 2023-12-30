import React from "react"
import {
    ComparisonLineConfig,
    ScaleType,
    EntitySelectionMode,
    ScatterPointLabelStrategy,
    SeriesName,
    Color,
    EntityName,
    OwidTableSlugs,
    ColorSchemeName,
    colorScaleConfigDefaults,
} from "@ourworldindata/types"
import { ComparisonLine } from "../scatterCharts/ComparisonLine"
import { observable, computed, action } from "mobx"
import { ScaleLinear, scaleSqrt } from "d3-scale"
import { Quadtree, quadtree } from "d3-quadtree"
import { quantize, interpolate } from "d3-interpolate"
import {
    intersection,
    without,
    excludeNullish,
    uniq,
    first,
    last,
    pairs,
    clone,
    excludeUndefined,
    flatten,
    isEmpty,
    isNumber,
    domainExtent,
    getRelativeMouse,
    lowerCaseFirstLetterUnlessAbbreviation,
    exposeInstanceOnWindow,
    groupBy,
    sampleFrom,
    intersectionOfSets,
    min,
    max,
    PointVector,
    Bounds,
    DEFAULT_BOUNDS,
} from "@ourworldindata/utils"
import { observer } from "mobx-react"
import { NoDataModal } from "../noDataModal/NoDataModal"
import {
    GRAPHER_AXIS_LINE_WIDTH_DEFAULT,
    GRAPHER_AXIS_LINE_WIDTH_THICK,
} from "../core/GrapherConstants"
import {
    OwidTable,
    defaultIfErrorValue,
    isNotErrorValue,
    CoreColumn,
    ColumnTypeMap,
} from "@ourworldindata/core-table"
import {
    ConnectedScatterLegend,
    ConnectedScatterLegendManager,
} from "./ConnectedScatterLegend"
import {
    VerticalColorLegend,
    VerticalColorLegendManager,
} from "../verticalColorLegend/VerticalColorLegend"
import { DualAxisComponent } from "../axis/AxisViews"
import { DualAxis, HorizontalAxis, VerticalAxis } from "../axis/Axis"

import {
    ColorScale,
    ColorScaleManager,
    NO_DATA_LABEL,
} from "../color/ColorScale"
import { AxisConfig } from "../axis/AxisConfig"
import { ChartInterface } from "../chart/ChartInterface"
import {
    ScatterPlotManager,
    ScatterSeries,
    SCATTER_LABEL_DEFAULT_FONT_SIZE_FACTOR,
    SCATTER_LABEL_MAX_FONT_SIZE_FACTOR,
    SCATTER_LABEL_MIN_FONT_SIZE_FACTOR,
    SCATTER_LINE_DEFAULT_WIDTH,
    SCATTER_LINE_MAX_WIDTH,
    SCATTER_POINT_DEFAULT_RADIUS,
    SCATTER_POINT_MAX_RADIUS,
    SeriesPoint,
    ScatterPointQuadtreeNode,
    SCATTER_QUADTREE_SAMPLING_DISTANCE,
} from "./ScatterPlotChartConstants"
import { ScatterPointsWithLabels } from "./ScatterPointsWithLabels"
import { autoDetectYColumnSlugs, makeSelectionArray } from "../chart/ChartUtils"
import { OwidNoDataGray } from "../color/ColorConstants"
import {
    ColorScaleConfig,
    ColorScaleConfigDefaults,
} from "../color/ColorScaleConfig"
import { SelectionArray } from "../selection/SelectionArray"
import { ColorScaleBin } from "../color/ColorScaleBin"
import {
    ScatterSizeLegend,
    ScatterSizeLegendManager,
} from "./ScatterSizeLegend"
import { Tooltip, TooltipState, TooltipValueRange } from "../tooltip/Tooltip"

@observer
export class ScatterPlotChart
    extends React.Component<{
        bounds?: Bounds
        manager: ScatterPlotManager
    }>
    implements
        ConnectedScatterLegendManager,
        ScatterSizeLegendManager,
        ChartInterface,
        VerticalColorLegendManager,
        ColorScaleManager
{
    // currently hovered legend color
    @observable private hoverColor?: Color
    // current hovered individual series + tooltip position
    @observable tooltipState = new TooltipState<{
        series: ScatterSeries
    }>()

    private filterManuallySelectedEntities(table: OwidTable): OwidTable {
        const { includedEntities, excludedEntities } = this.manager
        const excludedEntityIdsSet = new Set(excludedEntities)
        const includedEntityIdsSet = new Set(includedEntities)
        const excludeEntitiesFilter = (entityId: any): boolean =>
            !excludedEntityIdsSet.has(entityId as number)
        const includedEntitiesFilter = (entityId: any): boolean =>
            includedEntityIdsSet.size > 0
                ? includedEntityIdsSet.has(entityId as number)
                : true
        const filterFn = (entityId: any): boolean =>
            excludeEntitiesFilter(entityId) && includedEntitiesFilter(entityId)
        const excludedList = excludedEntities ? excludedEntities.join(", ") : ""
        const includedList = includedEntities ? includedEntities.join(", ") : ""
        return table.columnFilter(
            OwidTableSlugs.entityId,
            filterFn,
            `Excluded entity ids specified by author: ${excludedList} - Included entity ids specified by author: ${includedList}`
        )
    }

    transformTable(table: OwidTable): OwidTable {
        const {
            backgroundSeriesLimit,
            includedEntities,
            excludedEntities,
            addCountryMode,
        } = this.manager

        if (
            addCountryMode === EntitySelectionMode.Disabled ||
            addCountryMode === EntitySelectionMode.SingleEntity
        ) {
            table = table.filterByEntityNames(
                this.selectionArray.selectedEntityNames
            )
        }

        if (excludedEntities || includedEntities) {
            table = this.filterManuallySelectedEntities(table)
        }

        // Allow authors to limit the # of background entities to get better perf and clearer charts.
        if (backgroundSeriesLimit) {
            const selectedSeriesNames = new Set<SeriesName>(
                this.selectionArray.selectedEntityNames
            )
            // Todo: implement a better strategy for picking the entities to show for context. Maybe a couple per decile?
            const backgroundSeriesNames = new Set<SeriesName>(
                sampleFrom(
                    table.availableEntityNames.filter(
                        (name) => !selectedSeriesNames.has(name)
                    ),
                    backgroundSeriesLimit,
                    123
                )
            )
            table = table.columnFilter(
                table.entityNameSlug,
                (name) =>
                    selectedSeriesNames.has(name as string) ||
                    backgroundSeriesNames.has(name as string),
                `Capped background series at ${backgroundSeriesLimit}`
            )
        }

        if (this.xScaleType === ScaleType.log && this.xColumnSlug)
            table = table.replaceNonPositiveCellsForLogScale([this.xColumnSlug])

        if (this.yScaleType === ScaleType.log && this.yColumnSlug)
            table = table.replaceNonPositiveCellsForLogScale([this.yColumnSlug])

        if (this.sizeColumnSlug) {
            const tolerance =
                table.get(this.sizeColumnSlug)?.display?.tolerance ?? Infinity
            table = table.interpolateColumnWithTolerance(
                this.sizeColumnSlug,
                tolerance
            )
        }

        if (this.colorColumnSlug) {
            const tolerance =
                table.get(this.colorColumnSlug)?.display?.tolerance ?? Infinity
            table = table.interpolateColumnWithTolerance(
                this.colorColumnSlug,
                tolerance
            )
            if (this.manager.matchingEntitiesOnly) {
                table = table.dropRowsWithErrorValuesForColumn(
                    this.colorColumnSlug
                )
            }
        }

        // We want to "chop off" any rows outside the time domain for X and Y to avoid creating
        // leading and trailing timeline times that don't really exist in the dataset.
        const [timeDomainStart, timeDomainEnd] = table.timeDomainFor([
            this.xColumnSlug,
            this.yColumnSlug,
        ])
        table = table.filterByTimeRange(
            timeDomainStart ?? -Infinity,
            timeDomainEnd ?? Infinity
        )

        if (this.xOverrideTime !== undefined) {
            table = table.interpolateColumnWithTolerance(this.yColumnSlug)
        } else {
            table = table.interpolateColumnsByClosestTimeMatch(
                this.xColumnSlug,
                this.yColumnSlug
            )
        }

        // Drop any rows which have non-number values for X or Y.
        // This needs to be done after the tolerance, because the tolerance may fill in some gaps.
        table = table
            .columnFilter(
                this.xColumnSlug,
                isNumber,
                "Drop rows with non-number values in X column"
            )
            .columnFilter(
                this.yColumnSlug,
                isNumber,
                "Drop rows with non-number values in Y column"
            )

        // The tolerance application might lead to some data being dropped for some years.
        // For example, if X times are [2000, 2005, 2010], and Y times are [2005], then for all 3
        // rows we have the same match [[2005, 2005], [2005, 2005], [2005, 2005]].
        // This means we can drop 2000 and 2010 from the timeline.
        // It might not make a huge difference here, but it makes a difference when there are more
        // entities covering different time periods.
        const [originalTimeDomainStart, originalTimeDomainEnd] =
            table.originalTimeDomainFor([this.xColumnSlug, this.yColumnSlug])
        table = table.filterByTimeRange(
            originalTimeDomainStart ?? -Infinity,
            originalTimeDomainEnd ?? Infinity
        )

        return table
    }

    transformTableForDisplay(table: OwidTable): OwidTable {
        const { includedEntities, excludedEntities } = this.manager

        if (excludedEntities || includedEntities) {
            table = this.filterManuallySelectedEntities(table)
        }

        // Drop any rows which have non-number values for X or Y.
        table = table
            .columnFilter(
                this.xColumnSlug,
                isNumber,
                "Drop rows with non-number values in X column"
            )
            .columnFilter(
                this.yColumnSlug,
                isNumber,
                "Drop rows with non-number values in Y column"
            )
        return table
    }

    @computed get inputTable(): OwidTable {
        return this.manager.table
    }

    @computed private get transformedTableFromGrapher(): OwidTable {
        return (
            this.manager.transformedTable ??
            this.transformTable(this.inputTable)
        )
    }

    // TODO chunk this up into multiple computeds for better performance?
    @computed get transformedTable(): OwidTable {
        let table = this.transformedTableFromGrapher
        if (
            this.manager.hideLinesOutsideTolerance &&
            this.manager.startTime !== undefined &&
            this.manager.endTime !== undefined
        ) {
            const entityNames = Array.from(
                intersectionOfSets(
                    [this.manager.startTime, this.manager.endTime].map(
                        (targetTime) =>
                            table.filterByTargetTimes([targetTime], 0)
                                .availableEntityNameSet
                    )
                )
            )
            table = table.filterByEntityNames(entityNames)
        }
        // We don't want to apply this transform when relative mode is also enabled, it has a
        // sligthly different endpoints logic that drops initial zeroes to avoid DivideByZero error.
        if (this.compareEndPointsOnly && !this.manager.isRelativeMode) {
            table = table.keepMinTimeAndMaxTimeForEachEntityOnly()
        }
        if (this.manager.isRelativeMode) {
            table = table.toAverageAnnualChangeForEachEntity([
                this.xColumnSlug,
                this.yColumnSlug,
            ])
        }
        return table
    }

    @computed private get manager(): ScatterPlotManager {
        return this.props.manager
    }

    @computed.struct private get bounds(): Bounds {
        return this.props.bounds ?? DEFAULT_BOUNDS
    }

    @computed private get canAddCountry(): boolean {
        const { addCountryMode } = this.manager
        return (addCountryMode &&
            addCountryMode !== EntitySelectionMode.Disabled) as boolean
    }

    @computed private get selectionArray(): SelectionArray {
        return makeSelectionArray(this.manager)
    }

    @action.bound private onSelectEntity(entityName: SeriesName): void {
        if (this.canAddCountry) this.selectionArray.toggleSelection(entityName)
    }

    // Returns the colors that are used by all points, *across the whole timeline*.
    // This is why we need the table before the timeline filter is applied.
    @computed private get colorsInUse(): Color[] {
        const allValues =
            this.manager.tableAfterAuthorTimelineAndActiveChartTransform?.get(
                this.colorColumnSlug
            )?.valuesIncludingErrorValues ?? []
        // Need to convert InvalidCell to undefined for color scale to assign correct color
        const colorValues = uniq(
            allValues.map((value: any) =>
                isNotErrorValue(value) ? value : undefined
            )
        ) as (string | number)[]
        return excludeUndefined(
            colorValues.map((colorValue) =>
                this.colorScale.getColor(colorValue)
            )
        )
    }

    @computed get fontSize(): number {
        return this.manager.fontSize ?? BASE_FONT_SIZE
    }

    @action.bound onLegendMouseOver(color: string): void {
        this.hoverColor = color
    }

    @action.bound onLegendMouseLeave(): void {
        this.hoverColor = undefined
    }

    // When the color legend is clicked, toggle selection fo all associated keys
    @action.bound onLegendClick(): void {
        const { hoverColor, selectionArray } = this
        if (!this.canAddCountry || hoverColor === undefined) return

        const keysToToggle = this.series
            .filter((g) => g.color === hoverColor)
            .map((g) => g.seriesName)
        const allKeysActive =
            intersection(keysToToggle, this.selectedEntityNames).length ===
            keysToToggle.length
        if (allKeysActive)
            selectionArray.setSelectedEntities(
                without(this.selectedEntityNames, ...keysToToggle)
            )
        else
            selectionArray.setSelectedEntities(
                uniq(this.selectedEntityNames.concat(keysToToggle))
            )
    }

    // Colors on the legend for which every matching series is focused
    @computed get focusColors(): string[] {
        const { colorsInUse } = this
        return colorsInUse.filter((color) => {
            const matchingKeys = this.series
                .filter((g) => g.color === color)
                .map((g) => g.seriesName)
            return (
                intersection(matchingKeys, this.selectedEntityNames).length ===
                matchingKeys.length
            )
        })
    }

    // All currently hovered series keys, combining the legend and the main UI
    @computed private get hoveredSeriesNames(): string[] {
        const { hoverColor, tooltipState } = this

        const hoveredSeriesNames =
            hoverColor === undefined
                ? []
                : uniq(
                      this.series
                          .filter((g) => g.color === hoverColor)
                          .map((g) => g.seriesName)
                  )

        if (tooltipState.target) {
            hoveredSeriesNames.push(tooltipState.target.series.seriesName)
        }

        return hoveredSeriesNames
    }

    @computed private get focusedEntityNames(): string[] {
        return this.selectedEntityNames
    }

    @computed private get selectedEntityNames(): string[] {
        return this.selectionArray.selectedEntityNames
    }

    @computed get displayStartTime(): string {
        return this.transformedTable.timeColumn.formatTime(
            this.transformedTable.minTime ?? 1900
        )
    }

    @computed get displayEndTime(): string {
        return this.transformedTable.timeColumn.formatTime(
            this.transformedTable.maxTime ?? 2000
        )
    }

    @computed private get arrowLegend(): ConnectedScatterLegend | undefined {
        if (
            this.displayStartTime === this.displayEndTime ||
            this.xColumn instanceof ColumnTypeMap.Time ||
            this.yColumn instanceof ColumnTypeMap.Time ||
            this.manager.isRelativeMode
        )
            return undefined

        return new ConnectedScatterLegend(this)
    }

    @action.bound private onScatterMouseEnter(series: ScatterSeries): void {
        this.tooltipState.target = { series }
    }

    @action.bound private onScatterMouseLeave(): void {
        this.tooltipState.target = null
    }

    @action.bound private onScatterMouseMove(
        ev: React.MouseEvent<SVGGElement>
    ): void {
        const ref = this.manager?.base?.current
        if (ref) {
            this.tooltipState.position = getRelativeMouse(ref, ev)
        }
    }

    @action.bound private onScatterClick(): void {
        const { target } = this.tooltipState
        if (target) this.onSelectEntity(target.series.seriesName)
    }

    @computed get tooltipSeries(): ScatterSeries | undefined {
        return this.tooltipState.target?.series
    }

    @computed private get legendDimensions(): VerticalColorLegend {
        return new VerticalColorLegend({ manager: this })
    }

    @computed get maxLegendWidth(): number {
        return this.sidebarMaxWidth
    }

    @computed private get sidebarMinWidth(): number {
        return Math.max(this.bounds.width * 0.1, 60)
    }

    @computed private get sidebarMaxWidth(): number {
        return Math.max(this.bounds.width * 0.2, this.sidebarMinWidth)
    }

    @computed.struct get sidebarWidth(): number {
        const { legendDimensions, sidebarMinWidth, sidebarMaxWidth } = this

        return Math.max(
            Math.min(legendDimensions.width, sidebarMaxWidth),
            sidebarMinWidth
        )
    }

    // todo: Refactor
    @computed get dualAxis(): DualAxis {
        const { horizontalAxisPart, verticalAxisPart } = this
        return new DualAxis({
            bounds: this.bounds
                .padRight(this.sidebarWidth + 20)
                // top padding leaves room for tick labels
                .padTop(6)
                // bottom padding makes sure the x-axis label doesn't overflow
                .padBottom(2),
            horizontalAxis: horizontalAxisPart,
            verticalAxis: verticalAxisPart,
        })
    }

    @computed get yAxis(): VerticalAxis {
        return this.dualAxis.verticalAxis
    }

    @computed get xAxis(): HorizontalAxis {
        return this.dualAxis.horizontalAxis
    }

    @computed private get comparisonLines():
        | ComparisonLineConfig[]
        | undefined {
        return this.manager.comparisonLines
    }

    @action.bound private onToggleEndpoints(): void {
        this.manager.compareEndPointsOnly =
            !this.compareEndPointsOnly || undefined
    }

    // Colors currently on the chart and not greyed out
    @computed get activeColors(): string[] {
        const { hoveredSeriesNames, focusedEntityNames } = this
        const activeKeys = hoveredSeriesNames.concat(focusedEntityNames)

        let series = this.series

        if (activeKeys.length)
            series = series.filter((g) => activeKeys.includes(g.seriesName))

        const colorValues = uniq(
            flatten(series.map((s) => s.points.map((p) => p.color)))
        )
        return excludeUndefined(
            colorValues.map((color) => this.colorScale.getColor(color))
        )
    }

    @computed private get hideConnectedScatterLines(): boolean {
        return !!this.manager.hideConnectedScatterLines
    }

    @computed private get hideScatterLabels(): boolean {
        return !!this.manager.hideScatterLabels
    }

    @computed private get quadtree(): Quadtree<ScatterPointQuadtreeNode> {
        const {
            series: seriesArray,
            dualAxis: { horizontalAxis, verticalAxis, innerBounds },
        } = this

        const xAxis = horizontalAxis.clone()
        xAxis.range = innerBounds.xRange()
        const yAxis = verticalAxis.clone()
        yAxis.range = innerBounds.yRange()

        const nodes: ScatterPointQuadtreeNode[] = seriesArray.flatMap(
            (series) => {
                const points = series.points.map((point) => {
                    return new PointVector(
                        xAxis.place(point.x),
                        yAxis.place(point.y)
                    )
                })

                // add single points as is
                if (points.length < 2)
                    return points.map((point) => ({
                        series,
                        x: point.x,
                        y: point.y,
                    }))

                // sample points from line segments with a fixed step size
                return pairs(points, (a, b) => {
                    const numPoints =
                            2 + // always include endpoints
                            Math.floor(
                                PointVector.distance(a, b) /
                                    SCATTER_QUADTREE_SAMPLING_DISTANCE
                            ),
                        lineRange = interpolate(
                            { x: a.x, y: a.y },
                            { x: b.x, y: b.y }
                        ),
                        coords = quantize(
                            (pct: number) => clone(lineRange(pct)),
                            numPoints
                        )

                    return coords.map((point) => ({
                        series,
                        x: point.x,
                        y: point.y,
                    }))
                }).flat()
            }
        )

        return quadtree<ScatterPointQuadtreeNode>()
            .x(({ x }) => x)
            .y(({ y }) => y)
            .addAll(nodes)
    }

    @computed private get points(): JSX.Element {
        return (
            <ScatterPointsWithLabels
                noDataModalManager={this.manager}
                isConnected={this.isConnected}
                hideConnectedScatterLines={this.hideConnectedScatterLines}
                seriesArray={this.series}
                dualAxis={this.dualAxis}
                colorScale={
                    !this.colorColumn.isMissing ? this.colorScale : undefined
                }
                sizeScale={this.sizeScale}
                fontScale={this.fontScale}
                baseFontSize={this.fontSize}
                focusedSeriesNames={this.focusedEntityNames}
                hoveredSeriesNames={this.hoveredSeriesNames}
                tooltipSeriesName={this.tooltipSeries?.seriesName}
                disableIntroAnimation={this.manager.disableIntroAnimation}
                hideScatterLabels={this.hideScatterLabels}
                onMouseEnter={this.onScatterMouseEnter}
                onMouseLeave={this.onScatterMouseLeave}
                onClick={this.onScatterClick}
                quadtree={this.quadtree}
            />
        )
    }

    @computed private get colorColumnSlug(): string | undefined {
        return this.manager.colorColumnSlug
    }

    @computed private get colorColumn(): CoreColumn {
        return this.transformedTable.get(this.colorColumnSlug)
    }

    @computed get legendItems(): ColorScaleBin[] {
        return this.colorScale.legendBins.filter(
            (bin) =>
                this.colorsInUse.includes(bin.color) &&
                bin.label !== NO_DATA_LABEL
        )
    }

    @computed get legendTitle(): string | undefined {
        return this.colorScale.legendDescription
    }

    @computed get sizeScale(): ScaleLinear<number, number> {
        return scaleSqrt()
            .domain(this.sizeDomain)
            .range(
                this.sizeColumn.isMissing
                    ? // if the size column is missing, we want all points/lines to have the same width
                      this.isConnected
                        ? [
                              SCATTER_LINE_DEFAULT_WIDTH,
                              SCATTER_LINE_DEFAULT_WIDTH,
                          ]
                        : [
                              SCATTER_POINT_DEFAULT_RADIUS,
                              SCATTER_POINT_DEFAULT_RADIUS,
                          ]
                    : this.isConnected
                    ? // Note that the scale starts at 0.
                      // When using the scale to plot marks, we need to make sure the minimums
                      // (e.g. `SCATTER_POINT_MIN_RADIUS`) are respected.
                      [0, SCATTER_LINE_MAX_WIDTH]
                    : [0, SCATTER_POINT_MAX_RADIUS]
            )
    }

    @computed get fontScale(): ScaleLinear<number, number> {
        const defaultFontSize =
            SCATTER_LABEL_DEFAULT_FONT_SIZE_FACTOR * this.fontSize
        const minFontSize = SCATTER_LABEL_MIN_FONT_SIZE_FACTOR * this.fontSize
        const maxFontSize = SCATTER_LABEL_MAX_FONT_SIZE_FACTOR * this.fontSize
        return scaleSqrt()
            .domain(this.sizeDomain)
            .range(
                this.sizeColumn.isMissing
                    ? // if the size column is missing, we want all labels to have the same font size
                      [defaultFontSize, defaultFontSize]
                    : [minFontSize, maxFontSize]
            )
    }

    /** Whether series are shown as lines (instead of single points) */
    @computed private get isConnected(): boolean {
        return this.series.some((s) => s.points.length > 1)
    }

    @computed private get sizeLegend(): ScatterSizeLegend | undefined {
        if (this.isConnected || this.sizeColumn.isMissing) return undefined
        return new ScatterSizeLegend(this)
    }

    componentDidMount(): void {
        exposeInstanceOnWindow(this)
    }

    render(): JSX.Element {
        if (this.failMessage)
            return (
                <NoDataModal
                    manager={this.manager}
                    bounds={this.bounds}
                    message={this.failMessage}
                />
            )

        const {
            manager,
            bounds,
            dualAxis,
            arrowLegend,
            sizeLegend,
            sidebarWidth,
            comparisonLines,
            legendDimensions,
        } = this

        let sizeLegendY = bounds.top
        if (this.legendItems.length > 0) {
            sizeLegendY = bounds.top + legendDimensions.height + 16
        }
        const arrowLegendY = sizeLegend
            ? sizeLegendY + sizeLegend.height + 15
            : sizeLegendY

        return (
            <g className="ScatterPlot" onMouseMove={this.onScatterMouseMove}>
                <DualAxisComponent
                    dualAxis={dualAxis}
                    showTickMarks={false}
                    labelColor={manager.secondaryColorInStaticCharts}
                    lineWidth={
                        manager.isStaticAndSmall
                            ? GRAPHER_AXIS_LINE_WIDTH_THICK
                            : GRAPHER_AXIS_LINE_WIDTH_DEFAULT
                    }
                />
                {comparisonLines &&
                    comparisonLines.map((line, i) => (
                        <ComparisonLine
                            key={i}
                            dualAxis={dualAxis}
                            comparisonLine={line}
                        />
                    ))}
                {this.points}
                <VerticalColorLegend manager={this} />
                {sizeLegend && (
                    <>
                        {this.legendItems.length > 0 && (
                            <line
                                x1={bounds.right - sidebarWidth}
                                y1={sizeLegendY - 14}
                                x2={bounds.right - 5}
                                y2={sizeLegendY - 14}
                                stroke="#ccc"
                            />
                        )}
                        {sizeLegend.render(this.legendX, sizeLegendY)}
                    </>
                )}
                {arrowLegend && (
                    <>
                        <line
                            x1={bounds.right - sidebarWidth}
                            y1={arrowLegendY - 7}
                            x2={bounds.right - 5}
                            y2={arrowLegendY - 7}
                            stroke="#ccc"
                        />
                        <g
                            className="clickable"
                            onClick={this.onToggleEndpoints}
                        >
                            {arrowLegend.render(
                                bounds.right - sidebarWidth,
                                arrowLegendY
                            )}
                        </g>
                    </>
                )}
                {this.tooltip}
            </g>
        )
    }

    @computed get tooltip(): JSX.Element | null {
        if (!this.tooltipState.target) return null

        const {
            xColumn,
            yColumn,
            tooltipState: { target, position, fading },
        } = this
        const points = target.series.points ?? []
        const values = excludeNullish(uniq([first(points), last(points)]))

        let { startTime, endTime } = this.manager
        const { x: xStart, y: yStart } = first(values)?.time ?? {},
            { x: xEnd, y: yEnd } = last(values)?.time ?? {}

        let xValues = xStart === xEnd ? [values[0].x] : values.map((v) => v.x),
            xNoticeNeeded =
                (xStart !== undefined && xStart !== startTime && xStart) ||
                (xEnd !== undefined && xEnd !== endTime && xEnd),
            xNotice = xNoticeNeeded ? [xStart, xEnd] : []

        let yValues = yStart === yEnd ? [values[0].y] : values.map((v) => v.y),
            yNoticeNeeded =
                (yStart !== undefined && yStart !== startTime && yStart) ||
                (yEnd !== undefined && yEnd !== endTime && yEnd),
            yNotice = yNoticeNeeded ? [yStart, yEnd] : []

        // handle the special case where the same variable is used for both axes
        // with a different year's value on each
        if (
            xColumn.def.datasetId === yColumn.def.datasetId &&
            points.length === 1
        ) {
            const { x, y, time } = points[0]
            if (time.x !== time.y && isNumber(time.x) && isNumber(time.y)) {
                startTime = min([time.x, time.y])
                endTime = max([time.x, time.y])
                xValues = time.x < time.y ? [x, y] : [y, x]
                xNotice = yNotice = yValues = []
                xNoticeNeeded = yNoticeNeeded = false
            }
        }

        const { isRelativeMode } = this.manager,
            timeRange = uniq(excludeNullish([startTime, endTime]))
                .map((t) => this.yColumn.formatTime(t))
                .join(" to "),
            targetNotice =
                xNoticeNeeded || yNoticeNeeded ? timeRange : undefined,
            timeLabel =
                timeRange + (isRelativeMode ? " (avg. annual change)" : "")

        return (
            <Tooltip
                id="scatterTooltip"
                tooltipManager={this.manager}
                x={position.x}
                y={position.y}
                offsetX={20}
                offsetY={-16}
                style={{ maxWidth: "250px" }}
                title={target.series.label}
                subtitle={timeLabel}
                dissolve={fading}
                footer={targetNotice}
                footerFormat="notice"
            >
                <TooltipValueRange
                    column={xColumn}
                    values={xValues}
                    notice={xNotice}
                />
                <TooltipValueRange
                    column={yColumn}
                    values={yValues}
                    notice={yNotice}
                />
                <TooltipValueRange
                    column={this.sizeColumn}
                    values={excludeNullish(values.map((v) => v.size))}
                />
            </Tooltip>
        )
    }

    @computed get legendY(): number {
        return this.bounds.top
    }

    @computed get legendX(): number {
        return this.bounds.right - this.sidebarWidth
    }

    colorScale = this.props.manager.colorScaleOverride ?? new ColorScale(this)

    @computed get colorScaleColumn(): CoreColumn {
        return (
            // For faceted charts, we have to get the values of inputTable before it's filtered by
            // the faceting logic.
            this.manager.colorScaleColumnOverride ??
            // We need to use inputTable in order to get consistent coloring for a variable across
            // charts, e.g. each continent being assigned to the same color.
            // inputTable is unfiltered, so it contains every value that exists in the variable.
            this.inputTable.get(this.colorColumnSlug)
        )
    }

    @computed get colorScaleConfig(): ColorScaleConfigDefaults | undefined {
        return (
            ColorScaleConfig.fromDSL(this.colorColumn.def) ?? {
                ...colorScaleConfigDefaults,
                ...this.manager.colorScale,
            }
        )
    }

    defaultBaseColorScheme = ColorSchemeName.continents
    defaultNoDataColor = OwidNoDataGray

    @computed get hasNoDataBin(): boolean {
        if (this.colorColumn.isMissing) return false
        return this.colorColumn.valuesIncludingErrorValues.some(
            (value) => !isNotErrorValue(value)
        )
    }

    @computed private get yAxisConfig(): AxisConfig {
        return new AxisConfig(this.manager.yAxisConfig, this)
    }

    @computed private get xAxisConfig(): AxisConfig {
        return new AxisConfig(this.manager.xAxisConfig, this)
    }

    @computed private get yColumnSlug(): string {
        return autoDetectYColumnSlugs(this.manager)[0]
    }

    @computed private get yColumn(): CoreColumn {
        return this.transformedTable.get(this.yColumnSlug)
    }

    @computed private get xColumnSlug(): string {
        const { xColumnSlug } = this.manager
        return xColumnSlug ?? this.manager.table.timeColumn.slug
    }

    @computed private get xColumn(): CoreColumn {
        return this.transformedTable.get(this.xColumnSlug)
    }

    @computed private get sizeColumnSlug(): string | undefined {
        return this.manager.sizeColumnSlug
    }

    @computed get sizeColumn(): CoreColumn {
        return this.transformedTable.get(this.sizeColumnSlug)
    }

    @computed get failMessage(): string {
        if (this.yColumn.isMissing) return "Missing Y axis variable"

        if (this.yColumn.isMissing) return "Missing X axis variable"

        if (isEmpty(this.allEntityNamesWithXAndY)) {
            if (
                this.manager.isRelativeMode &&
                this.manager.hasTimeline &&
                this.manager.startTime === this.manager.endTime
            ) {
                return "Please select a start and end point on the timeline below"
            }
            return "No entities with data for both X and Y"
        }

        if (isEmpty(this.series)) return "No matching data"

        return ""
    }

    // todo: remove this. Should be done as a simple column transform at the data level.
    // Possible to override the x axis dimension to target a special year
    // In case you want to graph say, education in the past and democracy today https://ourworldindata.org/grapher/correlation-between-education-and-democracy
    @computed get xOverrideTime(): number | undefined {
        return this.manager.xOverrideTime
    }

    // Unlike other charts, the scatterplot shows all available data by default, and the selection
    // is just for emphasis. But this behavior can be disabled.
    @computed private get hideBackgroundEntities(): boolean {
        return this.manager.addCountryMode === EntitySelectionMode.Disabled
    }

    @computed private get allEntityNamesWithXAndY(): EntityName[] {
        return intersection(
            this.yColumn.uniqEntityNames,
            this.xColumn.uniqEntityNames
        )
    }

    // todo: remove. do this at table filter level
    getSeriesNamesToShow(
        filterBackgroundEntities = this.hideBackgroundEntities
    ): Set<SeriesName> {
        const seriesNames = filterBackgroundEntities
            ? this.selectionArray.selectedEntityNames
            : this.allEntityNamesWithXAndY

        if (this.manager.matchingEntitiesOnly && !this.colorColumn.isMissing)
            return new Set(
                intersection(seriesNames, this.colorColumn.uniqEntityNames)
            )

        return new Set(seriesNames)
    }

    @computed get compareEndPointsOnly(): boolean {
        return !!this.manager.compareEndPointsOnly
    }

    @computed get allPoints(): SeriesPoint[] {
        return flatten(this.series.map((series) => series.points))
    }

    // domains across the entire timeline
    private domainDefault(property: "x" | "y"): [number, number] {
        const scaleType = property === "x" ? this.xScaleType : this.yScaleType
        return domainExtent(
            this.pointsForAxisDomains.map((point) => point[property]),
            scaleType,
            this.manager.zoomToSelection && this.selectedPoints.length ? 1.1 : 1
        )
    }

    @computed private get validValuesForAxisDomainX(): number[] {
        const { xScaleType, pointsForAxisDomains } = this

        const values = pointsForAxisDomains.map((point) => point.x)
        return xScaleType === ScaleType.log
            ? values.filter((v) => v > 0)
            : values
    }

    @computed private get validValuesForAxisDomainY(): number[] {
        const { yScaleType, pointsForAxisDomains } = this

        const values = pointsForAxisDomains.map((point) => point.y)
        return yScaleType === ScaleType.log
            ? values.filter((v) => v > 0)
            : values
    }

    @computed private get xDomainDefault(): [number, number] {
        return this.domainDefault("x")
    }

    @computed private get selectedPoints(): SeriesPoint[] {
        const seriesNamesSet = this.getSeriesNamesToShow(true)
        return this.allPoints.filter(
            (point) => point.entityName && seriesNamesSet.has(point.entityName)
        )
    }

    @computed private get pointsForAxisDomains(): SeriesPoint[] {
        if (
            !this.selectionArray.numSelectedEntities ||
            !this.manager.zoomToSelection
        )
            return this.allPoints

        return this.selectedPoints.length ? this.selectedPoints : this.allPoints
    }

    @computed private get sizeDomain(): [number, number] {
        if (this.sizeColumn.isMissing) return [1, 100]
        const sizeValues = this.transformedTable
            .get(this.sizeColumn.slug)
            .values.filter(isNumber)
        return [0, max(sizeValues) ?? 1]
    }

    @computed private get yScaleType(): ScaleType {
        return this.manager.isRelativeMode
            ? ScaleType.linear
            : this.yAxisConfig.scaleType || ScaleType.linear
    }

    @computed private get yDomainDefault(): [number, number] {
        return this.domainDefault("y")
    }

    @computed private get verticalAxisPart(): VerticalAxis {
        const { manager, yDomainDefault, validValuesForAxisDomainY } = this
        const axisConfig = this.yAxisConfig

        const axis = axisConfig.toVerticalAxis()
        axis.formatColumn = this.yColumn
        const label = axisConfig.label || this.yColumn?.displayName || ""
        axis.scaleType = this.yScaleType

        if (manager.isRelativeMode) {
            axis.domain = yDomainDefault // Overwrite author's min/max
            if (label && label.length > 1) {
                axis.label = `Average annual change in ${lowerCaseFirstLetterUnlessAbbreviation(
                    label
                )}`
            }
        } else {
            const isAnyValueOutsideUserDomain = validValuesForAxisDomainY.some(
                (value) => value < axis.domain[0] || value > axis.domain[1]
            )

            // only overwrite the authors's min/max if there is more than one unique value along the y-axis
            // or if respecting the author's setting would hide data points
            if (
                new Set(validValuesForAxisDomainY).size > 1 ||
                isAnyValueOutsideUserDomain
            ) {
                axis.updateDomainPreservingUserSettings(yDomainDefault)
            }

            axis.label = label
        }

        return axis
    }

    @computed private get xScaleType(): ScaleType {
        return this.manager.isRelativeMode
            ? ScaleType.linear
            : this.xAxisConfig.scaleType ?? ScaleType.linear
    }

    @computed private get xAxisLabelBase(): string {
        const xDimName = this.xColumn?.displayName
        if (this.xOverrideTime !== undefined)
            return `${xDimName} in ${this.xOverrideTime}`
        return xDimName
    }

    @computed private get horizontalAxisPart(): HorizontalAxis {
        const { xDomainDefault, manager, xAxisLabelBase } = this
        const { xAxisConfig, validValuesForAxisDomainX } = this
        const axis = xAxisConfig.toHorizontalAxis()
        axis.formatColumn = this.xColumn
        axis.scaleType = this.xScaleType
        if (manager.isRelativeMode) {
            axis.domain = xDomainDefault // Overwrite author's min/max
            const label = xAxisConfig.label || xAxisLabelBase
            if (label && label.length > 1) {
                axis.label = `Average annual change in ${lowerCaseFirstLetterUnlessAbbreviation(
                    label
                )}`
            }
        } else {
            const isAnyValueOutsideUserDomain = validValuesForAxisDomainX.some(
                (value) => value < axis.domain[0] || value > axis.domain[1]
            )

            // only overwrite the authors's min/max if there is more than one unique value along the x-axis
            // or if respecting the author's setting would hide data points
            if (
                new Set(validValuesForAxisDomainX).size > 1 ||
                isAnyValueOutsideUserDomain
            ) {
                axis.updateDomainPreservingUserSettings(xDomainDefault)
            }

            const label = xAxisConfig.label || xAxisLabelBase
            if (label) axis.label = label
        }
        return axis
    }

    getPointLabel(rowIndex: number): string | undefined {
        const strat = this.manager.scatterPointLabelStrategy
        const { xColumn, yColumn } = this
        const { timeColumn } = this.transformedTable
        let label
        if (strat === ScatterPointLabelStrategy.y) {
            label = yColumn?.formatValue(
                yColumn.valuesIncludingErrorValues[rowIndex]
            )
        } else if (strat === ScatterPointLabelStrategy.x) {
            label = xColumn?.formatValue(
                xColumn.valuesIncludingErrorValues[rowIndex]
            )
        } else {
            label = timeColumn.formatTime(
                timeColumn.valuesIncludingErrorValues[rowIndex] as number
            )
        }
        return label
    }

    private removePointsOutsidePlane(points: SeriesPoint[]): SeriesPoint[] {
        const { yAxisConfig, xAxisConfig } = this
        if (
            yAxisConfig.removePointsOutsideDomain ||
            xAxisConfig.removePointsOutsideDomain
        ) {
            return points.filter((point) => {
                return (
                    !xAxisConfig.shouldRemovePoint(point.x) &&
                    !yAxisConfig.shouldRemovePoint(point.y)
                )
            })
        }
        return points
    }

    @computed private get allPointsBeforeEndpointsFilter(): SeriesPoint[] {
        const { entityNameColumn, timeColumn } = this.transformedTable
        const { xColumn, yColumn, sizeColumn, colorColumn } = this

        // We are running this filter first because it only depends on author-specified config, not
        // on any user interaction.
        return this.removePointsOutsidePlane(
            this.transformedTable.indices.map((rowIndex) => {
                return {
                    x: xColumn.valuesIncludingErrorValues[rowIndex] as number,
                    y: yColumn.valuesIncludingErrorValues[rowIndex] as number,
                    size: defaultIfErrorValue(
                        sizeColumn.valuesIncludingErrorValues[rowIndex],
                        undefined
                    ) as number | undefined,
                    color: defaultIfErrorValue(
                        colorColumn.valuesIncludingErrorValues[rowIndex],
                        undefined
                    ) as string | number | undefined,
                    entityName: entityNameColumn.valuesIncludingErrorValues[
                        rowIndex
                    ] as EntityName,
                    label: this.getPointLabel(rowIndex) ?? "",
                    timeValue: timeColumn.valuesIncludingErrorValues[
                        rowIndex
                    ] as number,
                    time: {
                        x: xColumn.originalTimeColumn
                            .valuesIncludingErrorValues[rowIndex] as number,
                        y: yColumn.originalTimeColumn
                            .valuesIncludingErrorValues[rowIndex] as number,
                    },
                }
            })
        )
    }

    @computed get series(): ScatterSeries[] {
        return Object.entries(
            groupBy(this.allPointsBeforeEndpointsFilter, (p) => p.entityName)
        ).map(([entityName, points]) => {
            const series: ScatterSeries = {
                seriesName: entityName,
                label: entityName,
                color: "#932834", // Default color, used when no color dimension is present
                points,
            }
            this.assignColorToSeries(entityName, series)
            return series
        })
    }

    private assignColorToSeries(
        entityName: EntityName,
        series: ScatterSeries
    ): void {
        if (series.points.length) {
            const keyColor =
                this.transformedTable.getColorForEntityName(entityName)
            if (keyColor !== undefined) series.color = keyColor
            else if (!this.colorColumn.isMissing) {
                const colorValue = last(
                    series.points.map((point) => point.color)
                )
                const color = this.colorScale.getColor(colorValue)
                if (color !== undefined) {
                    series.color = color
                    series.isScaleColor = true
                }
            }
        }
    }
}
