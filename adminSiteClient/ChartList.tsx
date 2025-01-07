import * as React from "react"
import { observer } from "mobx-react"
import { runInAction, observable } from "mobx"
import { bind } from "decko"
import { AdminAppContext, AdminAppContextType } from "./AdminAppContext.js"
import {
    GrapherChartType,
    GrapherInterface,
    GRAPHER_CHART_TYPES,
    GRAPHER_TAB_OPTIONS,
} from "@ourworldindata/types"
import { startCase, DbChartTagJoin } from "@ourworldindata/utils"
import { getFullReferencesCount } from "./ChartEditor.js"
import { ChartRow } from "./ChartRow.js"
import { References } from "./AbstractChartEditor.js"

// These properties are coming from OldChart.ts
export interface ChartListItem {
    // the first few entries mirror GrapherInterface, so take the types from there
    id: GrapherInterface["id"]
    title: GrapherInterface["title"]
    slug: GrapherInterface["slug"]
    internalNotes: GrapherInterface["internalNotes"]
    variantName: GrapherInterface["variantName"]
    isPublished: GrapherInterface["isPublished"]
    tab: GrapherInterface["tab"]
    hasMapTab: GrapherInterface["hasMapTab"]

    type?: GrapherChartType
    hasChartTab: boolean

    lastEditedAt: string
    lastEditedBy: string
    publishedAt: string
    publishedBy: string

    hasParentIndicator?: boolean
    isInheritanceEnabled?: boolean

    tags: DbChartTagJoin[]
    pageviewsPerDay: number
}

export type SortConfig = {
    field: "pageviewsPerDay"
    direction: "asc" | "desc"
} | null

@observer
export class ChartList extends React.Component<{
    charts: ChartListItem[]
    searchHighlight?: (text: string) => string | React.ReactElement
    onDelete?: (chart: ChartListItem) => void
    onSort?: (sort: SortConfig) => void
    sortConfig?: SortConfig
}> {
    static contextType = AdminAppContext
    context!: AdminAppContextType

    @observable availableTags: DbChartTagJoin[] = []

    async fetchRefs(grapherId: number | undefined): Promise<References> {
        const { admin } = this.context
        const json =
            grapherId === undefined
                ? {}
                : await admin.getJSON(
                      `/api/charts/${grapherId}.references.json`
                  )
        return json.references
    }

    @bind async onDeleteChart(chart: ChartListItem) {
        const refs = await this.fetchRefs(chart.id)
        if (getFullReferencesCount(refs) > 0) {
            window.alert(
                `Cannot delete chart ${
                    chart.slug
                } because it is used in ${getFullReferencesCount(
                    refs
                )} places. See the references tab in the chart editor for details.`
            )
            return
        }
        if (
            !window.confirm(
                `Delete the chart ${chart.slug}? This action cannot be undone!`
            )
        )
            return

        const json = await this.context.admin.requestJSON(
            `/api/charts/${chart.id}`,
            {},
            "DELETE"
        )

        if (json.success) {
            if (this.props.onDelete) this.props.onDelete(chart)
            else
                runInAction(() =>
                    this.props.charts.splice(
                        this.props.charts.indexOf(chart),
                        1
                    )
                )
        }
    }

    @bind async getTags() {
        const json = await this.context.admin.getJSON("/api/tags.json")
        runInAction(() => (this.availableTags = json.tags))
    }

    componentDidMount() {
        void this.getTags()
    }

    render() {
        const { charts, searchHighlight, sortConfig, onSort } = this.props
        const { availableTags } = this

        const getSortIndicator = () => {
            if (!sortConfig || sortConfig.field !== "pageviewsPerDay") return ""
            return sortConfig.direction === "desc" ? " ↓" : " ↑"
        }

        const handleSortClick = () => {
            if (!sortConfig || sortConfig.field !== "pageviewsPerDay") {
                onSort?.({ field: "pageviewsPerDay", direction: "desc" })
            } else if (sortConfig.direction === "desc") {
                onSort?.({ field: "pageviewsPerDay", direction: "asc" })
            } else {
                onSort?.(null)
            }
        }

        // if the first chart has inheritance information, we assume all charts have it
        const showInheritanceColumn =
            charts[0]?.isInheritanceEnabled !== undefined

        return (
            <table className="table table-bordered">
                <thead>
                    <tr>
                        <th></th>
                        <th>Chart</th>
                        <th>Id</th>
                        <th>Type</th>
                        {showInheritanceColumn && <th>Inheritance</th>}
                        <th>Tags</th>
                        <th>Published</th>
                        <th>Last Updated</th>
                        <th
                            style={{ cursor: "pointer" }}
                            onClick={handleSortClick}
                        >
                            views/day{getSortIndicator()}
                        </th>
                        <th></th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {charts.map((chart) => (
                        <ChartRow
                            chart={chart}
                            key={chart.id}
                            availableTags={availableTags}
                            searchHighlight={searchHighlight}
                            onDelete={this.onDeleteChart}
                            showInheritanceColumn={showInheritanceColumn}
                        />
                    ))}
                </tbody>
            </table>
        )
    }
}

export function showChartType(chart: ChartListItem): string {
    const chartType = chart.type

    if (!chartType) return "Map"

    const displayType = GRAPHER_CHART_TYPES[chartType]
        ? startCase(GRAPHER_CHART_TYPES[chartType])
        : "Unknown"

    if (chart.tab === GRAPHER_TAB_OPTIONS.map) {
        if (chart.hasChartTab) return `Map + ${displayType}`
        else return "Map"
    } else {
        if (chart.hasMapTab) return `${displayType} + Map`
        else return displayType
    }
}
