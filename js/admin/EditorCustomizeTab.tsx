import * as React from 'react'
import { computed, action } from 'mobx'
import { observer } from 'mobx-react'
import ChartEditor from './ChartEditor'
import ChartConfig from '../charts/ChartConfig'
import { AxisConfigProps } from '../charts/AxisConfig'
import { TextField, NumberField, SelectField, Toggle, FieldsRow, Section, BindAutoString } from './Forms'
import ColorSchemes from '../charts/ColorSchemes'
import { debounce } from '../charts/Util'

@observer
class ColorSchemeSelector extends React.Component<{ chart: ChartConfig }> {
    @action.bound onValue(value: string) {
        this.props.chart.props.baseColorScheme = value === 'default' ? undefined : value
    }

    @action.bound onInvertColorScheme(value: boolean) {
        this.props.chart.props.invertColorScheme = value || undefined
    }

    render() {
        const { chart } = this.props

        const availableColorSchemes = Object.keys(ColorSchemes)
        const colorSchemeLabels = availableColorSchemes.map(scheme => ColorSchemes[scheme].name)

        return <FieldsRow>
            <SelectField label="Color scheme" value={chart.baseColorScheme || "default"} onValue={this.onValue} options={["default"].concat(availableColorSchemes)} optionLabels={["Default"].concat(colorSchemeLabels)} /><br />
            <Toggle label="Invert colors" value={!!chart.props.invertColorScheme} onValue={this.onInvertColorScheme} />
        </FieldsRow>
    }
}

@observer
class TimeSection extends React.Component<{ editor: ChartEditor }> {
    base: HTMLDivElement

    @computed get chart() { return this.props.editor.chart }

    @computed get isDynamicTime() {
        return this.chart.timeDomain[0] === undefined && this.chart.timeDomain[1] === undefined
    }

    @computed get minTime() { return this.chart.props.minTime }
    @computed get maxTime() { return this.chart.props.maxTime }
    @computed get minPossibleTime() {
        return this.chart.data.primaryVariable ? this.chart.data.primaryVariable.minYear : 1900
    }
    @computed get maxPossibleTime() {
        return this.chart.data.primaryVariable ? this.chart.data.primaryVariable.maxYear : 2015
    }

    @action.bound onToggleDynamicTime() {
        if (this.isDynamicTime) {
            this.chart.timeDomain = [this.minPossibleTime, this.maxPossibleTime]
        } else {
            this.chart.timeDomain = [undefined, undefined]
        }
    }

    @action.bound onMinTime(value: number | undefined) {
        this.chart.props.minTime = value
    }

    @action.bound onMaxTime(value: number | undefined) {
        this.chart.props.maxTime = value
    }

    render() {
        const { features } = this.props.editor
        const { chart } = this

        return <Section name="Time range">
            <FieldsRow>
                {features.timeDomain && <NumberField label="Min year" value={chart.props.minTime} onValue={debounce(this.onMinTime)} />}
                <NumberField label={features.timeDomain ? "Max year" : "Target year"} value={chart.props.maxTime} onValue={debounce(this.onMaxTime)} />
            </FieldsRow>
        </Section>
    }
}

@observer
export default class EditorCustomizeTab extends React.Component<{ editor: ChartEditor }> {
    @computed get xAxis() { return this.props.editor.chart.xAxis.props }
    @computed get yAxis() { return this.props.editor.chart.yAxis.props }

    renderForAxis(_: string, axis: AxisConfigProps) {
        return <div>
            <FieldsRow>
                <NumberField label={`Min`} value={axis.min} onValue={(value) => axis.min = value} />
                <NumberField label={`Max`} value={axis.max} onValue={(value) => axis.max = value} />
            </FieldsRow>
            <Toggle label={`Enable log/linear selector`} value={axis.canChangeScaleType || false} onValue={(value) => axis.canChangeScaleType = value || undefined} />
        </div>
    }

    render() {
        const { xAxis, yAxis } = this
        const { features } = this.props.editor
        const { chart } = this.props.editor

        return <div>
            {features.customYAxis && <Section name="Y Axis">
                {this.renderForAxis('Y', yAxis)}
            </Section>}
            {features.customXAxis && <Section name="X Axis">
                {this.renderForAxis('X', xAxis)}
            </Section>}
            {!chart.isScatter && <TimeSection editor={this.props.editor} />}
            <Section name="Colors">
                <ColorSchemeSelector chart={chart} />
            </Section>
            {(features.hideLegend || features.relativeModeToggle) && <Section name="Legend">
                <FieldsRow>
                    {features.hideLegend && <Toggle label={`Hide legend`} value={!!chart.hideLegend} onValue={(value) => chart.props.hideLegend = value || undefined} />}
                    {features.relativeModeToggle && <Toggle label={`Hide relative toggle`} value={!!chart.props.hideRelativeToggle} onValue={value => chart.props.hideRelativeToggle = value || undefined} />}
                </FieldsRow>
                {features.entityType && <BindAutoString label="Entity name" field="entityType" store={chart.props} auto="country"/>}
            </Section>}
        </div>
    }
}
