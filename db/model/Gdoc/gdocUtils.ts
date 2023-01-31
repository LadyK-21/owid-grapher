import { OwidEnrichedArticleBlock, Span } from "@ourworldindata/utils"
import { match } from "ts-pattern"
import * as cheerio from "cheerio"

export function spanToHtmlString(s: Span): string {
    return match(s)
        .with({ spanType: "span-simple-text" }, (span) => span.text)
        .with(
            { spanType: "span-link" },
            (span) =>
                `<a href="${span.url}">${spansToHtmlString(span.children)}</a>`
        )
        .with(
            { spanType: "span-ref" },
            (span) =>
                `<a href="${span.url}" class="ref">${spansToHtmlString(
                    span.children
                )}</a>`
        )
        .with({ spanType: "span-newline" }, () => "</br>")
        .with(
            { spanType: "span-italic" },
            (span) => `<i>${spansToHtmlString(span.children)}</i>`
        )
        .with(
            { spanType: "span-bold" },
            (span) => `<b>${spansToHtmlString(span.children)}</b>`
        )
        .with(
            { spanType: "span-underline" },
            (span) => `<u>${spansToHtmlString(span.children)}</u>`
        )
        .with(
            { spanType: "span-subscript" },
            (span) => `<sub>${spansToHtmlString(span.children)}</sub>`
        )
        .with(
            { spanType: "span-superscript" },
            (span) => `<sup>${spansToHtmlString(span.children)}</sup>`
        )
        .with(
            { spanType: "span-quote" },
            (span) => `<q>${spansToHtmlString(span.children)}</q>`
        )
        .with(
            { spanType: "span-fallback" },
            (span) => `<span>${spansToHtmlString(span.children)}</span>`
        )
        .exhaustive()
}

export function spansToHtmlString(spans: Span[]): string {
    if (spans.length === 0) return ""
    else {
        const result = spans.map(spanToHtmlString).join("")
        return result
    }
}

// Sometimes Google automatically linkifies a URL.
// We always want the plaintext, not '<a href="www.ourworldindata.org">www.ourworldindata.org</a>'
export function extractPlaintextUrl(html: string = ""): string {
    if (html.trim().startsWith("http")) return html.trim()
    const $ = cheerio.load(html)
    return $("a").text()
}

export const getTitleSupertitleFromHeadingText = (
    headingText: string
): [string, string | undefined] => {
    const VERTICAL_TAB_CHAR = "\u000b"
    const [beforeSeparator, afterSeparator] =
        headingText.split(VERTICAL_TAB_CHAR)

    return [
        afterSeparator || beforeSeparator,
        afterSeparator ? beforeSeparator : undefined,
    ]
}

export function recursivelyMapArticleBlock(
    block: OwidEnrichedArticleBlock,
    callback: (block: OwidEnrichedArticleBlock) => OwidEnrichedArticleBlock
): OwidEnrichedArticleBlock {
    if (block.type === "gray-section") {
        block.items.map((block) => recursivelyMapArticleBlock(block, callback))
    }
    if (
        block.type === "sticky-left" ||
        block.type === "sticky-right" ||
        block.type === "side-by-side"
    ) {
        block.left.map((node) => recursivelyMapArticleBlock(node, callback))
        block.right.map((node) => recursivelyMapArticleBlock(node, callback))
    }

    return callback(block)
}
