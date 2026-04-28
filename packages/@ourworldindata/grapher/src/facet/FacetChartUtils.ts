export const getFacetGridPadding = ({
    labelFontSize,
    labelPadding,
    shouldAddRowPadding = true,
    shouldAddColumnPadding = true,
}: {
    labelFontSize: number
    labelPadding: number
    shouldAddRowPadding?: boolean
    shouldAddColumnPadding?: boolean
}): { rowPadding: number; columnPadding: number; outerPadding: number } => {
    const labelHeight = labelFontSize

    const rowPadding = shouldAddRowPadding ? labelFontSize : 0
    const columnPadding = shouldAddColumnPadding ? labelFontSize : 0

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
