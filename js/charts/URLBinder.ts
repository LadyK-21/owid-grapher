/* URLBinder.ts
 * ================
 *
 * This component is responsible for handling data binding between the
 * the chartView and url parameters, to enable nice linking support
 * for specific countries and years.
 *
 */

import * as _ from 'lodash'
import * as $ from 'jquery'
import {computed, observable, autorun, action, reaction, toJS} from 'mobx'
import ChartView from './ChartView'
import ChartTabOption from './ChartTabOption'
import ScaleType from './ScaleType'
import {defaultTo} from './Util'
import ChartConfig, {ChartConfigProps} from './ChartConfig'
import EntityKey from './EntityKey'
import {getQueryParams, setQueryVariable, setQueryStr, queryParamsToStr, QueryParams} from './Util'

interface ChartQueryParams {
    tab?: string,
    stackMode?: string,
    xScale?: string,
    yScale?: string,
    time?: string,
    year?: string,
    region?: string,
    country?: string,
    shown?: string
}

export default class URLBinder {
    chart: ChartConfig
    origChart: ChartConfigProps
    chartQueryStr: string = "?"
    mapQueryStr: string = "?"

    constructor(chart: ChartConfig) {
        this.chart = chart
        this.origChart = toJS(chart.props)
        window.origChart = this.origChart
        this.populateFromURL(getQueryParams())

        // There is a surprisingly considerable performance overhead to updating the url
        // while animating, so we debounce to allow e.g. smoother timelines
        const pushParams = _.debounce(function(params: ChartQueryParams) {
            requestAnimationFrame(() => setQueryStr(queryParamsToStr(params as QueryParams)))
        }, 50)
        autorun(() => {
            const {params} = this
            pushParams(params)
        })
    }

    // Autocomputed url params to reflect difference between current chart state
    // and original config state
    @computed.struct get params(): ChartQueryParams {
        const params: ChartQueryParams = {}
        const {chart, origChart} = this

        params.tab = chart.props.tab == origChart.tab ? undefined : chart.tab
        params.xScale = chart.props.xAxis.scaleType == origChart.xAxis.scaleType ? undefined : chart.xAxis.scaleType
        params.yScale = chart.props.yAxis.scaleType == origChart.yAxis.scaleType? undefined : chart.yAxis.scaleType
        params.year = this.yearParam
        params.time = this.timeParam
        params.country = this.countryParam

        return params
    }

    @computed get yearParam(): string|undefined {
        const {chart, origChart} = this

        if (chart.tab == 'map' && chart.props.map && origChart.map && chart.props.map.targetYear != origChart.map.targetYear) {
            return _.toString(chart.props.map.targetYear)
        } else {
            return undefined
        }
    }

    @computed get timeParam(): string|undefined {
        const {chart} = this

        const {timeDomain} = chart.props
        if (!_.isEqual(timeDomain, this.origChart.timeDomain)) {
            if (_.isFinite(timeDomain[0]) && _.isFinite(timeDomain[1]) && timeDomain[0] != timeDomain[1]) {
                return timeDomain[0] + ".." + timeDomain[1]
            } else if (_.isNumber(timeDomain[0])) {
                return _.toString(timeDomain[0])
            }
        } else {
            return undefined
        }
    }

    @computed get countryParam(): string|undefined {
        const {chart, origChart} = this
        if (chart.vardata.isReady && !_.isEqual(toJS(chart.props.selectedEntities), origChart.selectedEntities)) {
            function getCode(entity: EntityKey) { 
                const meta = chart.vardata.entityMetaByKey[entity]
                return meta ? meta.code : entity
            }
            const codes = chart.selectedEntities.map(getCode).map(encodeURIComponent)
            return codes.join("+")
        } else {
            return undefined
        }
    }

    /**
     * Set e.g. &shown=Africa when the user selects Africa on a stacked area chartView or other
     * toggle-based legend chartView.
     */
    updateLegendKeys() {
        /*var activeLegendKeys = chartView.model.get("activeLegendKeys");
        if (activeLegendKeys === null)
            setQueryVariable("shown", null);
        else {
            var keys = _.map(activeLegendKeys, function(key) {
                return encodeURIComponent(key);
            });
            setQueryVariable("shown", keys.join("+"));
        }*/
     }

    /**
     * Set e.g. &year=1990 when the user uses the map slider to go to 1990
     */
    updateYearParam() {
        //if (chart.tab == 'map')
        //    setQueryVariable("year", chartView.map.get("targetYear"));
    }


    getCurrentLink() {
        var baseUrl = Global.rootUrl + "/" + this.chart.slug,
            queryParams = getQueryParams(),
            queryStr = queryParamsToStr(queryParams),
            canonicalUrl = baseUrl + queryStr;

        return canonicalUrl
    }

    /**
     * Apply any url parameters on chartView startup
     */    
    populateFromURL(params: ChartQueryParams) {
        const {chart} = this

        // Set tab if specified
        const tab = params.tab;
        if (tab) {
            if (!_.includes(chart.availableTabs, tab) && tab !== 'download')
                console.error("Unexpected tab: " + tab);
            else
                chart.tab = (tab as ChartTabOption)
        }

        // Stack mode for bar and stacked area charts
        //chart.currentStackMode = defaultTo(params.stackMode, chart.currentStackMode)

        // Axis scale mode
        const xScaleType = params.xScale
        if (xScaleType) {
            if (xScaleType == 'linear' || xScaleType == 'log')
                chart.xAxis.scaleType = xScaleType
            else
                console.error("Unexpected xScale: " + xScaleType)
        }

        const yScaleType = params.yScale
        if (yScaleType) {
            if (yScaleType == 'linear' || yScaleType == 'log')
                chart.yAxis.scaleType = yScaleType
            else
                console.error("Unexpected xScale: " + yScaleType)
        }
        
        var time = params.time;
        if (time !== undefined) {
            const m = time.match(/^(\d+)\.\.(\d+)$/)
            if (m) {
                chart.timeDomain = [parseInt(m[1]), parseInt(m[2])]
            } else {
                chart.timeDomain = [parseInt(time), parseInt(time)]
            }
        }

        // Map stuff below

        /*var year = params.year;
        if (year !== undefined) {
            chartView.map.set("defaultYear", parseInt(year));
        }

        var region = params.region;
        if (region !== undefined) {
            chartView.map.set("defaultProjection", region);
        }*/

        // Selected countries -- we can't actually look these up until we have the data
        var country = params.country;
        autorun(() => {
            if (!chart.data.availableEntities) return

            action(() => {
                if (country) {
                    const entityCodes = _.map(country.split('+'), decodeURIComponent)                    
                    chart.selectedEntities = _.filter(chart.data.availableEntities, entity => {
                        const meta = chart.vardata.entityMetaByKey[entity]                        
                        return _.includes(entityCodes, meta.code) || _.includes(entityCodes, meta.name)
                    })
                }
            })()
        })

        // Set shown legend keys for chartViews with toggleable series
        var shown = params.shown;
        if (_.isString(shown)) {
            var keys = _.map(shown.split("+"), function(key) {
                return decodeURIComponent(key);
            });

            chart.activeLegendKeys = keys
        }
    }
}