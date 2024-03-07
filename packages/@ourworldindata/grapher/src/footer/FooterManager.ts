import { TooltipManager } from "../tooltip/TooltipProps"
import { DetailsMarker } from "@ourworldindata/types"
import { ActionButtonsManager } from "../controls/ActionButtons"

export interface FooterManager extends TooltipManager, ActionButtonsManager {
    sourcesLine?: string
    note?: string
    hasOWIDLogo?: boolean
    originUrlWithProtocol?: string
    detailsOrderedByReference?: string[]
    shouldIncludeDetailsInStaticExport?: boolean
    isSourcesModalOpen?: boolean
    isSmall?: boolean
    isMedium?: boolean
    framePaddingHorizontal?: number
    useBaseFontSize?: boolean
    fontSize?: number
    isInFullScreenMode?: boolean
    isEmbeddedInAnOwidPage?: boolean
    isEmbeddedInADataPage?: boolean
    hideNote?: boolean
    hideOriginUrl?: boolean
    secondaryColorInStaticCharts?: string
    isStaticAndSmall?: boolean
    detailsMarkerInSvg?: DetailsMarker
}
