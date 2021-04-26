import React from "react"
import { SubNavId } from "../../clientUtils/owidTypes"
import { SubnavItem, subnavs } from "../SiteSubnavigation"

export const getSubnavItem = (
    id: string | undefined,
    subnavItems: SubnavItem[]
) => {
    // We want to avoid matching elements with potentially undefined id.
    // Static typing prevents id from being undefined but this might not be
    // the case in a future API powered version.
    return id ? subnavItems.find((item) => item.id === id) : undefined
}

export const getSubnavParent = (
    currentItem: SubnavItem | undefined,
    subnavItems: SubnavItem[]
) => {
    const parentId = currentItem?.parentId
    // We want to avoid matching elements with potentially undefined id.
    // Static typing prevents id from being undefined but this might not be
    // the case in a future API powered version.
    return parentId
        ? subnavItems.find((item) => item.id === parentId)
        : undefined
}

export const getBreadcrumbItems = (
    subnavCurrentId: string | undefined,
    subnavItems: SubnavItem[]
): SubnavItem[] | undefined => {
    const breadcrumb = []
    let currentItem = getSubnavItem(subnavCurrentId, subnavItems)
    if (!currentItem) return
    breadcrumb.push(currentItem)

    while (currentItem && currentItem.parentId) {
        currentItem = getSubnavParent(currentItem, subnavItems)
        if (currentItem) breadcrumb.push(currentItem)
    }
    if (currentItem !== subnavItems[0]) breadcrumb.push(subnavItems[0]) // add topic as parent
    return breadcrumb.reverse()
}

export const Breadcrumb = ({
    subnavId,
    subnavCurrentId,
}: {
    subnavId?: SubNavId
    subnavCurrentId?: string
}) => {
    const breadcrumbItems = subnavId
        ? getBreadcrumbItems(subnavCurrentId, subnavs[subnavId])
        : null

    return (
        <div className="breadcrumb">
            {breadcrumbItems ? (
                breadcrumbItems.map((item, idx) => (
                    <React.Fragment key={item.href}>
                        {idx !== breadcrumbItems.length - 1 ? (
                            <>
                                <a href={item.href}>{item.label}</a>
                                <span className="separator">&gt;</span>
                            </>
                        ) : (
                            <span>{item.label}</span>
                        )}
                    </React.Fragment>
                ))
            ) : (
                <span>Contents</span>
            )}
        </div>
    )
}
