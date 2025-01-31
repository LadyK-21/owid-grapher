import {
    ExplorerChoiceParams,
    ExplorerControlType,
    GridBoolean,
    DecisionMatrix,
    TableDef,
} from "@ourworldindata/explorer"
import { at, get, groupBy, mapValues, orderBy, partition, uniq } from "lodash"
import { MarkdownTextWrap } from "@ourworldindata/components"
import { logErrorAndMaybeCaptureInSentry } from "../../../serverUtils/errorLog.js"
import { obtainAvailableEntitiesForGraphers } from "../../updateChartEntities.js"
import { fetchS3MetadataByPath } from "../../../db/model/Variable.js"
import { getVariableMetadataRoute } from "@ourworldindata/grapher"
import pMap from "p-map"
import { ExplorerAdminServer } from "../../../explorerAdminServer/ExplorerAdminServer.js"
import { GIT_CMS_DIR } from "../../../gitCms/GitCmsConstants.js"
import { parseDelimited } from "@ourworldindata/core-table"
import {
    ColumnTypeNames,
    CoreRow,
    MinimalExplorerInfo,
} from "@ourworldindata/types"

import * as db from "../../../db/db.js"
import { DATA_API_URL } from "../../../settings/serverSettings.js"
import { keyBy } from "@ourworldindata/utils"
import { getAnalyticsPageviewsByUrlObj } from "../../../db/model/Pageview.js"
import {
    CsvUnenrichedExplorerViewRecord,
    EnrichedExplorerRecord,
    EntitiesByColumnDictionary,
    ExplorerIndicatorMetadataDictionary,
    ExplorerIndicatorMetadataFromDb,
    ExplorerViewFinalRecord,
    ExplorerViewBaseRecord,
    ExplorerViewGrapherInfo,
    GrapherEnrichedExplorerViewRecord,
    GrapherUnenrichedExplorerViewRecord,
    IndicatorEnrichedExplorerViewRecord,
    IndicatorUnenrichedExplorerViewRecord,
    CsvEnrichedExplorerViewRecord,
    ConvertedExplorerChartHit,
} from "./types.js"
import {
    processAvailableEntities as processRecordAvailableEntities,
    scaleRecordScores,
} from "./shared.js"
import {
    ChartRecord,
    ChartRecordType,
} from "../../../site/search/searchTypes.js"
import { getUniqueNamesFromParentTagArrays } from "@ourworldindata/utils/dist/Util.js"

export function explorerViewRecordToChartRecord(
    e: ExplorerViewFinalRecord
): ConvertedExplorerChartHit {
    return {
        type: ChartRecordType.ExplorerView,
        objectID: e.objectID!,
        chartId: -1,
        slug: e.explorerSlug,
        queryParams: e.viewQueryParams,
        title: e.viewTitle,
        subtitle: e.explorerSubtitle,
        variantName: "",
        keyChartForTags: [],
        tags: e.tags,
        availableEntities: e.availableEntities,
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        numDimensions: e.numNonDefaultSettings,
        titleLength: e.titleLength,
        numRelatedArticles: 0,
        views_7d: e.explorerViews_7d,
        viewTitleIndexWithinExplorer: e.viewTitleIndexWithinExplorer,
        score: e.score,
    }
}

/**
 * Scale explorer record scores then convert them to ChartRecords.
 * Each explorer has a default view (whichever is defined first in the decision matrix)
 * We scale these default view scores between 0 and 10000, but the rest we scale between 0 and 1000
 * to bury them under the (higher quality) grapher views in the data catalog.
 */
export function adaptExplorerViews(
    explorerViews: ExplorerViewFinalRecord[]
): ChartRecord[] {
    const [firstViews, rest] = partition(
        explorerViews,
        (view) => view.isFirstExplorerView
    )
    return [
        ...scaleRecordScores(firstViews, [1000, 10000]),
        ...scaleRecordScores(rest, [0, 1000]),
    ].map(explorerViewRecordToChartRecord)
}

// Creates a search-ready string from a choice.
// Special handling is pretty much only necessary for checkboxes: If they are not ticked, then their name is not included.
// Imagine a "Per capita" checkbox, for example. If it's not ticked, then we don't want searches for "per capita" to wrongfully match it.
const explorerChoiceToViewSettings = (
    choices: ExplorerChoiceParams,
    decisionMatrix: DecisionMatrix
): string[] => {
    return Object.entries(choices).map(([choiceName, choiceValue]) => {
        const choiceControlType =
            decisionMatrix.choiceNameToControlTypeMap.get(choiceName)
        if (choiceControlType === ExplorerControlType.Checkbox)
            return choiceValue === GridBoolean.true ? choiceName : ""
        else return choiceValue
    })
}

/**
 * Takes records with `yVariableIds` and fetches their metadata.
 * First it fetches base metadata from the DB, then it fetches availableEntities from S3.
 * Returns a dictionary of metadata by id (and path, when possible):
 * ```
 * {
 *   123: { id: 123, name: "GDP", entityNames: ["United States", "Canada"] },
 *   "an/etl#path": { id: "an/etl#path", name: "GDP", entityNames: ["United States", "Canada"] }
 * }
 * ```
 */
async function fetchIndicatorMetadata(
    records: IndicatorUnenrichedExplorerViewRecord[],
    trx: db.KnexReadonlyTransaction
): Promise<ExplorerIndicatorMetadataDictionary> {
    function checkIsETLPath(idOrPath: string | number): idOrPath is string {
        return typeof idOrPath === "string"
    }

    const { etlPaths, ids } = records.reduce(
        ({ etlPaths, ids }, record) => {
            for (const yVariableId of record.yVariableIds) {
                if (checkIsETLPath(yVariableId)) {
                    etlPaths.add(yVariableId)
                } else {
                    ids.add(yVariableId)
                }
            }
            return { etlPaths, ids }
        },
        { etlPaths: new Set<string>(), ids: new Set<number>() }
    )

    const metadataFromDB = (
        await trx
            .table("variables")
            .select(
                "id",
                "catalogPath",
                "name",
                "titlePublic",
                "display",
                "descriptionShort"
            )
            .whereIn("id", [...ids])
            .orWhereIn("catalogPath", [...etlPaths])
    ).map((row) => ({
        ...row,
        display: row.display ? JSON.parse(row.display) : {},
    })) as ExplorerIndicatorMetadataFromDb[]

    const indicatorMetadataByIdAndPath = {
        ...keyBy(metadataFromDB, "id"),
        ...keyBy(metadataFromDB, "catalogPath"),
    } as ExplorerIndicatorMetadataDictionary

    async function fetchEntitiesForId(id: number) {
        const metadata = await fetchS3MetadataByPath(
            getVariableMetadataRoute(DATA_API_URL, id)
        )
        const entityNames = get(metadata, "dimensions.entities.values", [])
            .map((value) => value.name)
            .filter((name): name is string => !!name)

        const idEntry = indicatorMetadataByIdAndPath[id]
        if (idEntry) {
            idEntry.entityNames = entityNames
        }
        const path = metadata.catalogPath
        if (path) {
            const pathEntry = indicatorMetadataByIdAndPath[path]
            if (pathEntry) {
                pathEntry.entityNames = entityNames
            }
        }
    }

    await pMap(
        metadataFromDB.map((meta) => meta.id),
        fetchEntitiesForId,
        { concurrency: 10 }
    )

    return indicatorMetadataByIdAndPath
}

/** Almost always `"country"`, but sometimes things like `"location"` */
function getEntityNameSlug(tableDef: TableDef): string {
    return (
        tableDef.columnDefinitions?.find(
            (col) => col.type === ColumnTypeNames.EntityName
        )?.slug || "country"
    )
}

/**
 * Returns an aggregator function that can be used to aggregate entities per column in a parsed CSV
 * e.g. if there's a column named "gdp", this will return an object like `{ gdp: Set<string> }`
 * containing all the entities that have any data for gdp.
 */
function makeAggregator(entityNameSlug: string) {
    return (
        result: Record<string, Set<string>>,
        row: Record<string, string>
    ) => {
        const entityName = row[entityNameSlug]
        Object.keys(row).forEach((columnSlug) => {
            if (columnSlug === entityNameSlug || columnSlug === "year") return

            const value = row[columnSlug]
            if (value) {
                if (!result[columnSlug]) {
                    result[columnSlug] = new Set()
                }
                if (entityName) {
                    result[columnSlug].add(entityName)
                }
            }
        })

        return result
    }
}

/**
 * Fetches the CSVs for all of an explorer's tables, parses them, and aggregates their entities per column.
 * Returns an object like:
 * ```
 * {
 *   almonds: { population: ["United States", "Canada"], food__tonnes: ["United States"] },
 *   olives: { population: ["United States", "Canada"], food__tonnes: ["United States", "Greece"] },
 * }
 * ```
 */
async function getEntitiesPerColumnPerTable(
    tableDefs: TableDef[]
): Promise<EntitiesByColumnDictionary> {
    return pMap(
        tableDefs,
        (tableDef) => {
            console.log("Fetching CSV table data from", tableDef.url)
            return fetch(tableDef.url!)
                .then((res) => res.text())
                .then((csv) => parseDelimited(csv))
                .then((parsed) => {
                    const entityNameSlug = getEntityNameSlug(tableDef)
                    const aggregateEntities = makeAggregator(entityNameSlug)
                    const entitiesPerColumn = parsed.reduce(
                        aggregateEntities,
                        {}
                    )

                    // Convert sets to arrays
                    const entityNamesAsArray = mapValues(
                        entitiesPerColumn,
                        (set) => Array.from(set)
                    ) as Record<string, string[]>

                    return { [tableDef.slug!]: entityNamesAsArray }
                })
        },
        {
            concurrency: 5,
        }
        // Merge all these objects together
    ).then((results) => Object.assign({}, ...results))
}

const computeExplorerViewScore = (record: {
    explorerViews_7d: number
    numNonDefaultSettings: number
    titleLength: number
}) =>
    (record.explorerViews_7d || 0) * 10 -
    record.numNonDefaultSettings * 50 -
    record.titleLength

const parseYVariableIds = (matrixRow: CoreRow): (string | number)[] => {
    return (
        matrixRow.yVariableIds
            ?.trim()
            .split(" ")
            .map((idOrPath: string) =>
                isNaN(parseInt(idOrPath)) ? idOrPath : parseInt(idOrPath)
            ) || []
    )
}

const getNonDefaultSettings = (
    choice: ExplorerChoiceParams,
    matrix: DecisionMatrix
): [string, any][] => {
    const defaultSettings = matrix.defaultSettings
    return Object.entries(matrix.availableChoiceOptions).filter(
        ([choiceName, choiceOptions]) => {
            return (
                choiceOptions.length > 1 &&
                !(defaultSettings[choiceName] !== undefined
                    ? defaultSettings[choiceName] === choice[choiceName]
                    : choice[choiceName] === choiceOptions[0])
            )
        }
    )
}

const createBaseRecord = (
    choice: ExplorerChoiceParams,
    matrix: DecisionMatrix,
    index: number,
    explorerInfo: MinimalExplorerInfo
): ExplorerViewBaseRecord => {
    matrix.setValuesFromChoiceParams(choice)
    const nonDefaultSettings = getNonDefaultSettings(choice, matrix)
    const yVariableIds = parseYVariableIds(matrix.selectedRow)

    return {
        availableEntities: [],
        viewTitle: matrix.selectedRow.title,
        viewSubtitle: matrix.selectedRow.subtitle,
        viewSettings: explorerChoiceToViewSettings(choice, matrix),
        viewGrapherId: matrix.selectedRow.grapherId,
        yVariableIds,
        viewQueryParams: matrix.toString(),
        viewIndexWithinExplorer: index,
        numNonDefaultSettings: nonDefaultSettings.length,
        tableSlug: matrix.selectedRow.tableSlug,
        ySlugs: matrix.selectedRow.ySlugs?.split(" ") || [],
        explorerSlug: explorerInfo.slug,
        isFirstExplorerView: index === 0,
    }
}

const createBaseRecords = (
    explorerInfo: MinimalExplorerInfo,
    matrix: DecisionMatrix
): ExplorerViewBaseRecord[] => {
    return matrix
        .allDecisionsAsQueryParams()
        .map((choice: ExplorerChoiceParams, index: number) =>
            createBaseRecord(choice, matrix, index, explorerInfo)
        )
}

const fetchGrapherInfo = async (
    trx: db.KnexReadonlyTransaction,
    grapherIds: number[]
): Promise<Record<number, ExplorerViewGrapherInfo>> => {
    return await trx
        .select(
            trx.raw("charts.id as id"),
            trx.raw("chart_configs.full->>'$.title' as title"),
            trx.raw("chart_configs.full->>'$.subtitle' as subtitle")
        )
        .from("charts")
        .join("chart_configs", { "charts.configId": "chart_configs.id" })
        .whereIn("charts.id", grapherIds)
        .andWhereRaw("chart_configs.full->>'$.isPublished' = 'true'")
        .then((rows) => keyBy(rows, "id"))
}

async function enrichRecordWithGrapherInfo(
    record: GrapherUnenrichedExplorerViewRecord,
    grapherInfo: Record<number, ExplorerViewGrapherInfo>,
    availableEntities: Map<number, { availableEntities: string[] }>,
    explorerInfo: MinimalExplorerInfo
): Promise<GrapherEnrichedExplorerViewRecord | undefined> {
    const grapher = grapherInfo[record.viewGrapherId]
    if (!grapher) {
        await logErrorAndMaybeCaptureInSentry({
            name: "ExplorerViewGrapherMissing",
            message: `Explorer with slug "${explorerInfo.slug}" has a view with a missing grapher: ${record.viewQueryParams}.`,
        })
        return
    }

    return {
        ...record,
        availableEntities:
            availableEntities.get(record.viewGrapherId)?.availableEntities ??
            [],
        viewTitle: grapher.title,
        viewSubtitle: grapher.subtitle,
        titleLength: grapher.title.length,
    }
}

const enrichWithGrapherData = async (
    trx: db.KnexReadonlyTransaction,
    records: GrapherUnenrichedExplorerViewRecord[],
    explorerInfo: MinimalExplorerInfo
): Promise<GrapherEnrichedExplorerViewRecord[]> => {
    if (!records.length) return []
    const grapherIds = records.map((record) => record.viewGrapherId as number)

    console.log(
        `Fetching grapher configs from ${grapherIds.length} graphers for explorer ${explorerInfo.slug}`
    )
    const grapherInfo = await fetchGrapherInfo(trx, grapherIds)
    const availableEntities = await obtainAvailableEntitiesForGraphers(
        trx,
        grapherIds
    )

    const enrichedRecords: GrapherEnrichedExplorerViewRecord[] = []
    for (const record of records) {
        const enrichedRecord = await enrichRecordWithGrapherInfo(
            record,
            grapherInfo,
            availableEntities,
            explorerInfo
        )
        if (enrichedRecord) enrichedRecords.push(enrichedRecord)
    }
    return enrichedRecords
}

async function enrichRecordWithTableData(
    record: CsvUnenrichedExplorerViewRecord,
    entitiesPerColumnPerTable: EntitiesByColumnDictionary
): Promise<CsvEnrichedExplorerViewRecord | undefined> {
    const { tableSlug, ySlugs, viewTitle } = record
    if (!tableSlug || !ySlugs?.length || !viewTitle) {
        await logErrorAndMaybeCaptureInSentry({
            name: "ExplorerViewMissingData",
            message: `Explorer with slug "${record.explorerSlug}" has a view with missing data: ${record.viewQueryParams}.`,
        })
        return
    }

    const availableEntities = uniq(
        ySlugs.flatMap((ySlug) => entitiesPerColumnPerTable[tableSlug][ySlug])
    ).filter((name): name is string => !!name)

    return {
        ...record,
        availableEntities,
        titleLength: viewTitle.length,
    }
}

async function enrichWithTableData(
    records: CsvUnenrichedExplorerViewRecord[],
    entitiesPerColumnPerTable: EntitiesByColumnDictionary
): Promise<CsvEnrichedExplorerViewRecord[]> {
    const enrichedRecords: CsvEnrichedExplorerViewRecord[] = []

    for (const record of records) {
        const enrichedRecord = await enrichRecordWithTableData(
            record,
            entitiesPerColumnPerTable
        )
        if (enrichedRecord) {
            enrichedRecords.push(enrichedRecord)
        }
    }
    return enrichedRecords
}

async function enrichRecordWithIndicatorData(
    record: IndicatorUnenrichedExplorerViewRecord,
    indicatorMetadataDictionary: ExplorerIndicatorMetadataDictionary
): Promise<IndicatorEnrichedExplorerViewRecord | undefined> {
    const allEntityNames = at(indicatorMetadataDictionary, record.yVariableIds)
        .filter(Boolean)
        .flatMap((meta) => meta.entityNames)

    const uniqueNonEmptyEntityNames = uniq(allEntityNames).filter(
        (name): name is string => !!name
    )

    const firstYIndicator = record.yVariableIds[0]

    const indicatorInfo = indicatorMetadataDictionary[firstYIndicator]
    if (!indicatorInfo) {
        await logErrorAndMaybeCaptureInSentry({
            name: "ExplorerViewIndicatorMissing",
            message: `Explorer with slug "${record.explorerSlug}" has a view with missing indicator metadata: ${record.viewQueryParams}.`,
        })
        return
    }

    const viewTitle =
        record.viewTitle ||
        indicatorInfo.titlePublic ||
        indicatorInfo.display?.name ||
        (indicatorInfo.name as string)

    const viewSubtitle =
        record.viewSubtitle || (indicatorInfo.descriptionShort as string)

    return {
        ...record,
        availableEntities: uniqueNonEmptyEntityNames,
        viewTitle,
        viewSubtitle,
        titleLength: viewTitle.length,
    }
}

async function enrichWithIndicatorMetadata(
    indicatorBaseRecords: IndicatorUnenrichedExplorerViewRecord[],
    indicatorMetadataDictionary: ExplorerIndicatorMetadataDictionary
): Promise<IndicatorEnrichedExplorerViewRecord[]> {
    return pMap(indicatorBaseRecords, (indicatorBaseRecord) =>
        enrichRecordWithIndicatorData(
            indicatorBaseRecord,
            indicatorMetadataDictionary
        )
    ).then((r) => r.filter(Boolean) as IndicatorEnrichedExplorerViewRecord[])
}

function processSubtitles(
    records: EnrichedExplorerRecord[]
): EnrichedExplorerRecord[] {
    return records.map((record) => {
        // Remove markdown links from text
        const viewSubtitle = record.viewSubtitle
            ? new MarkdownTextWrap({
                  text: record.viewSubtitle,
                  fontSize: 10,
              }).plaintext
            : undefined
        return {
            ...record,
            viewSubtitle,
        } as EnrichedExplorerRecord
    })
}

async function processAvailableEntities(
    records: EnrichedExplorerRecord[]
): Promise<EnrichedExplorerRecord[]> {
    const processedRecords: EnrichedExplorerRecord[] = []
    for (const record of records) {
        const availableEntities = processRecordAvailableEntities(
            record.availableEntities
        )
        if (!availableEntities) {
            await logErrorAndMaybeCaptureInSentry({
                name: "ExplorerViewMissingData",
                message: `Explorer with slug "${record.explorerSlug}" has a view with missing entities: ${record.viewQueryParams}.`,
            })
        } else {
            processedRecords.push({
                ...record,
                availableEntities,
            })
        }
    }
    return processedRecords
}

async function finalizeRecords(
    records: EnrichedExplorerRecord[],
    slug: string,
    pageviews: Record<string, { views_7d: number }>,
    explorerInfo: MinimalExplorerInfo
): Promise<ExplorerViewFinalRecord[]> {
    const withCleanSubtitles = processSubtitles(records)

    const withCleanEntities = await processAvailableEntities(withCleanSubtitles)

    const withPageviews = withCleanEntities.map((record) => ({
        ...record,
        explorerViews_7d: get(pageviews, [`/explorers/${slug}`, "views_7d"], 0),
    }))

    const unsortedFinalRecords = withPageviews.map(
        (
            record,
            i
        ): Omit<ExplorerViewFinalRecord, "viewTitleIndexWithinExplorer"> => ({
            ...record,
            viewSettings: record.viewSettings.filter((x): x is string => !!x),
            viewTitle: record.viewTitle!,
            viewSubtitle: record.viewSubtitle!,
            explorerSlug: explorerInfo.slug,
            explorerTitle: explorerInfo.title,
            explorerSubtitle: explorerInfo.subtitle,
            viewTitleAndExplorerSlug: `${record.viewTitle} | ${explorerInfo.slug}`,
            numViewsWithinExplorer: withPageviews.length,
            tags: explorerInfo.tags,
            objectID: `${explorerInfo.slug}-${i}`,
            score: computeExplorerViewScore(record),
        })
    )

    const sortedByScore = orderBy(
        unsortedFinalRecords,
        computeExplorerViewScore,
        "desc"
    )

    const groupedByTitle = groupBy(sortedByScore, "viewTitle")

    const indexedExplorerViewData = Object.values(groupedByTitle).flatMap(
        (records) =>
            records.map((record, i) => ({
                ...record,
                viewTitleIndexWithinExplorer: i,
            }))
    )

    return indexedExplorerViewData
}

export const getExplorerViewRecordsForExplorer = async (
    trx: db.KnexReadonlyTransaction,
    explorerInfo: MinimalExplorerInfo,
    pageviews: Record<string, { views_7d: number }>,
    explorerAdminServer: ExplorerAdminServer,
    skipGrapherViews: boolean
): Promise<ExplorerViewFinalRecord[]> => {
    const { slug } = explorerInfo
    const explorerProgram = await explorerAdminServer.getExplorerFromSlug(slug)

    console.log(
        `Creating ${explorerProgram.decisionMatrix.numRows} base records for explorer ${slug}`
    )
    const baseRecords = createBaseRecords(
        explorerInfo,
        explorerProgram.decisionMatrix
    )

    const [grapherBaseRecords, nonGrapherBaseRecords] = partition(
        baseRecords,
        (record) => record.viewGrapherId !== undefined
    ) as [GrapherUnenrichedExplorerViewRecord[], ExplorerViewBaseRecord[]]

    let enrichedGrapherRecords: GrapherEnrichedExplorerViewRecord[] = []
    if (!skipGrapherViews) {
        enrichedGrapherRecords = await enrichWithGrapherData(
            trx,
            grapherBaseRecords,
            explorerInfo
        )
    }

    const [indicatorBaseRecords, csvBaseRecords] = partition(
        nonGrapherBaseRecords,
        (record) => record.yVariableIds.length > 0
    ) as [
        IndicatorUnenrichedExplorerViewRecord[],
        CsvUnenrichedExplorerViewRecord[],
    ]

    // Fetch and apply indicator metadata
    console.log("Fetching indicator metadata for explorer", slug)
    const indicatorMetadataDictionary = await fetchIndicatorMetadata(
        indicatorBaseRecords,
        trx
    )

    console.log("Fetched indicator metadata for explorer", slug)

    const enrichedIndicatorRecords = await enrichWithIndicatorMetadata(
        indicatorBaseRecords,
        indicatorMetadataDictionary
    )

    const tableDefs = explorerProgram.tableSlugs
        .map((tableSlug) => explorerProgram.getTableDef(tableSlug))
        .filter((x) => x && x.url && x.slug) as TableDef[]

    // Fetch and process CSV table data
    console.log(
        `Fetching CSV table data for ${slug} and aggregating entities by column`
    )
    const entitiesPerColumnPerTable =
        await getEntitiesPerColumnPerTable(tableDefs)
    console.log(
        "Finished fetching CSV table data and aggregating entities by column"
    )

    const enrichedCsvRecords = await enrichWithTableData(
        csvBaseRecords,
        entitiesPerColumnPerTable
    )

    const enrichedRecords = [
        ...enrichedGrapherRecords,
        ...enrichedIndicatorRecords,
        ...enrichedCsvRecords,
    ]

    // // Finalize records with titles, sorting, and grouping
    return finalizeRecords(enrichedRecords, slug, pageviews, explorerInfo)
}

async function getExplorersWithInheritedTags(trx: db.KnexReadonlyTransaction) {
    const explorersBySlug = await db.getPublishedExplorersBySlug(trx)
    // The DB query gets the tags for the explorer, but we need to add the parent tags as well.
    // This isn't done in the query because it would require a recursive CTE.
    // It's easier to write that query once, separately, and reuse it.
    const parentTagArrays = await db.getParentTagArraysByChildName(trx)
    const publishedExplorersWithTags = []

    for (const explorer of Object.values(explorersBySlug)) {
        if (!explorer.tags.length) {
            await logErrorAndMaybeCaptureInSentry({
                name: "ExplorerTagMissing",
                message: `Explorer "${explorer.slug}" has no tags.`,
            })
        }
        const tags = new Set<string>()

        for (const tagName of explorer.tags) {
            tags.add(tagName)
            const parentTagNames = getUniqueNamesFromParentTagArrays(
                parentTagArrays[tagName]
            )
            for (const parentTagName of parentTagNames) {
                tags.add(parentTagName)
            }
        }

        publishedExplorersWithTags.push({
            ...explorer,
            tags: Array.from(tags),
        })
    }

    return publishedExplorersWithTags
}

export const getExplorerViewRecords = async (
    trx: db.KnexReadonlyTransaction,
    skipGrapherViews = false
): Promise<ExplorerViewFinalRecord[]> => {
    console.log("Getting explorer view records")
    if (skipGrapherViews) {
        console.log("(Skipping grapher views)")
    }
    const publishedExplorersWithTags = await getExplorersWithInheritedTags(trx)
    const pageviews = await getAnalyticsPageviewsByUrlObj(trx)

    const explorerAdminServer = new ExplorerAdminServer(GIT_CMS_DIR)

    const records = await pMap(
        publishedExplorersWithTags,
        (explorerInfo) =>
            getExplorerViewRecordsForExplorer(
                trx,
                explorerInfo,
                pageviews,
                explorerAdminServer,
                skipGrapherViews
            ),
        { concurrency: 1 }
    ).then((records) => records.flat())

    return records
}
