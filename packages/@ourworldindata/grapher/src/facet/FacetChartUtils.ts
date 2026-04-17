import {
    BASE_FONT_SIZE,
    GRAPHER_FONT_SCALE_10,
    GRAPHER_FONT_SCALE_11,
    GRAPHER_FONT_SCALE_12,
    GRAPHER_FONT_SCALE_13,
} from "../core/GrapherConstants"

const roundToHalf = (value: number): number => Math.round(value * 2) / 2

export const getFontSize = (
    containerWidth: number,
    cellWidth: number,
    baseFontSize = BASE_FONT_SIZE,
    minSize = 10
): number => {
    // Pick a fixed font size for very small charts
    if (containerWidth < 300)
        return roundToHalf(GRAPHER_FONT_SCALE_10 * baseFontSize)

    // Scale the font size based on the space available per facet
    const scaled = (ratio: number): number =>
        Math.max(minSize, roundToHalf(baseFontSize * ratio))

    if (cellWidth >= 300) return scaled(GRAPHER_FONT_SCALE_13)
    if (cellWidth >= 200) return scaled(GRAPHER_FONT_SCALE_12)

    return scaled(GRAPHER_FONT_SCALE_11)
}

export const getFacetGridPadding = ({
    baseFontSize,
    labelPadding,
    shouldAddRowPadding = true,
    shouldAddColumnPadding = true,
}: {
    baseFontSize: number
    labelPadding: number
    shouldAddRowPadding?: boolean
    shouldAddColumnPadding?: boolean
}): { rowPadding: number; columnPadding: number; outerPadding: number } => {
    const labelHeight = baseFontSize

    const rowPadding = shouldAddRowPadding ? baseFontSize : 0
    const columnPadding = shouldAddColumnPadding ? baseFontSize : 0

    return {
        rowPadding: Math.round(labelHeight + labelPadding + rowPadding),
        columnPadding: Math.round(columnPadding),
        outerPadding: 0,
    }
}

export const calculateAspectRatio = (width: number, height: number): number => {
    const aspectRatio = width / height // can be NaN if height is 0, which can happen when the chart is temporarily hidden
    if (isNaN(aspectRatio)) return 1
    return aspectRatio
}
