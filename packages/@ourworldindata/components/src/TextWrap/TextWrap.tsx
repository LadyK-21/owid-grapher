import { max, stripHTML, Bounds, FontFamily, last } from "@ourworldindata/utils"
import { computed } from "mobx"
import React from "react"
import { Fragment, joinFragments, splitIntoFragments } from "./TextWrapUtils"

declare type FontSize = number

interface TextWrapProps {
    text: string
    maxWidth: number
    lineHeight?: number
    fontSize: FontSize
    fontWeight?: number
    firstLineOffset?: number
    separators?: string[]
    rawHtml?: boolean
}

interface WrapLine {
    text: string
    width: number
    height: number
}

interface OpenHtmlTag {
    tag: string // e.g. "a" for an <a> tag, or "span" for a <span> tag
    fullTag: string // e.g. "<a href='https://ourworldindata.org'>"
}

const HTML_OPENING_CLOSING_TAG_REGEX = /<(\/?)([A-Za-z]+)( [^<>]*)?>/g

function startsWithNewline(text: string): boolean {
    return /^\n/.test(text)
}

export const shortenForTargetWidth = (
    text: string,
    targetWidth: number,
    fontSettings: {
        fontSize?: number
        fontWeight?: number
        fontFamily?: FontFamily
    } = {}
): string => {
    // use binary search to find the largest substring that fits within the target width
    let low = 0
    let high = text.length
    while (low <= high) {
        const mid = (high + low) >> 1
        const bounds = Bounds.forText(text.slice(0, mid), fontSettings)
        if (bounds.width < targetWidth) {
            low = mid + 1
        } else {
            high = mid - 1
        }
    }
    return text.slice(0, low - 1)
}

export class TextWrap {
    props: TextWrapProps
    constructor(props: TextWrapProps) {
        this.props = props
    }

    @computed get maxWidth(): number {
        return this.props.maxWidth ?? Infinity
    }
    @computed get lineHeight(): number {
        return this.props.lineHeight ?? 1.1
    }
    @computed get fontSize(): FontSize {
        return this.props.fontSize ?? 1
    }
    @computed get fontWeight(): number | undefined {
        return this.props.fontWeight
    }
    @computed get text(): string {
        return this.props.text
    }
    @computed get separators(): string[] {
        return this.props.separators ?? [" "]
    }
    @computed get firstLineOffset(): number {
        return this.props.firstLineOffset ?? 0
    }

    // We need to take care that HTML tags are not split across lines.
    // Instead, we want every line to have opening and closing tags for all tags that appear.
    // This is so we don't produce invalid HTML.
    processHtmlTags(lines: WrapLine[]): WrapLine[] {
        const currentlyOpenTags: OpenHtmlTag[] = []
        for (const line of lines) {
            // Prepend any still-open tags to the start of the line
            const prependOpenTags = currentlyOpenTags
                .map((t) => t.fullTag)
                .join("")

            const tagMatches = line.text.matchAll(
                HTML_OPENING_CLOSING_TAG_REGEX
            )
            for (const tag of tagMatches) {
                const isOpeningTag = tag[1] !== "/"
                if (isOpeningTag) {
                    currentlyOpenTags.push({
                        tag: tag[2],
                        fullTag: tag[0],
                    })
                } else {
                    if (
                        !currentlyOpenTags.length ||
                        currentlyOpenTags.at(-1)?.tag !== tag[2]
                    ) {
                        throw new Error(
                            "TextWrap: Opening and closing HTML tags do not match"
                        )
                    }
                    currentlyOpenTags.pop()
                }
            }

            // Append any unclosed tags to the end of the line
            const appendCloseTags = [...currentlyOpenTags]
                .reverse()
                .map((t) => `</${t.tag}>`)
                .join("")
            line.text = prependOpenTags + line.text + appendCloseTags
        }
        return lines
    }

    @computed get lines(): WrapLine[] {
        const { text, separators, maxWidth, fontSize, fontWeight } = this

        // Prepend spaces so that the string is also split before newline characters
        // See startsWithNewline
        const fragments = splitIntoFragments(
            text.replace(/\n/g, " \n"),
            separators
        )

        const lines: WrapLine[] = []

        let line: Fragment[] = []
        let lineBounds = Bounds.empty()

        fragments.forEach((fragment) => {
            const nextLine = line.concat([fragment])

            // Strip HTML if a raw string is passed
            const text = this.props.rawHtml
                ? stripHTML(joinFragments(nextLine))
                : joinFragments(nextLine)

            let nextBounds = Bounds.forText(text, {
                fontSize,
                fontWeight,
            })

            // add offset to the first line if given
            if (lines.length === 0 && this.firstLineOffset) {
                nextBounds = nextBounds.set({
                    width: nextBounds.width + this.firstLineOffset,
                })
            }

            // start a new line before the current word if the max-width is exceeded.
            // usually breaking into a new line doesn't make sense if the current line is empty.
            // but if the first line is offset (which is useful in grouped text wraps),
            // we might want to break into a new line anyway.
            const startNewLineBeforeWord =
                nextBounds.width + 10 > maxWidth &&
                (line.length >= 1 || this.firstLineOffset)

            if (startsWithNewline(fragment.text) || startNewLineBeforeWord) {
                // Introduce a newline _before_ this word
                lines.push({
                    text: joinFragments(line),
                    width: lineBounds.width,
                    height: lineBounds.height,
                })
                // ... and start a new line with this word (with a potential leading newline stripped)
                const wordWithoutNewline = fragment.text.replace(/^\n/, "")
                line = [
                    {
                        text: wordWithoutNewline,
                        separator: fragment.separator,
                    },
                ]
                lineBounds = Bounds.forText(wordWithoutNewline, {
                    fontSize,
                    fontWeight,
                })
            } else {
                line = nextLine
                lineBounds = nextBounds
            }
        })

        // Push the last line
        if (line.length > 0)
            lines.push({
                text: joinFragments(line),
                width: lineBounds.width,
                height: lineBounds.height,
            })

        // Process HTML to ensure that each opening tag has a matching closing tag _in each line_
        if (this.props.rawHtml) return this.processHtmlTags(lines)
        else return lines
    }

    @computed get lineCount(): number {
        return this.lines.length
    }

    @computed get singleLineHeight(): number {
        return this.fontSize * this.lineHeight
    }

    @computed get height(): number {
        if (this.lineCount === 0) return 0
        return this.lineCount * this.singleLineHeight
    }

    @computed get width(): number {
        return max(this.lines.map((l) => l.width)) ?? 0
    }

    @computed get lastLineWidth(): number {
        return last(this.lines)?.width ?? 0
    }

    @computed get htmlStyle(): any {
        const { fontSize, fontWeight, lineHeight } = this
        return {
            fontSize: fontSize.toFixed(2) + "px",
            fontWeight: fontWeight,
            lineHeight: lineHeight,
            overflowY: "visible",
        }
    }

    renderHTML(): React.ReactElement | null {
        const { props, lines } = this

        if (lines.length === 0) return null

        return (
            <span>
                {lines.map((line, index) => {
                    const content = props.rawHtml ? (
                        <span
                            dangerouslySetInnerHTML={{
                                __html: line.text,
                            }}
                        />
                    ) : (
                        <span>{line.text}</span>
                    )
                    return (
                        <React.Fragment key={index}>
                            {content}
                            <br />
                        </React.Fragment>
                    )
                })}
            </span>
        )
    }

    getPositionForSvgRendering(x: number, y: number): [number, number] {
        const { lines, fontSize, lineHeight } = this

        // Magic number set through experimentation.
        // The HTML and SVG renderers need to position lines identically.
        // This number was tweaked until the overlaid HTML and SVG outputs
        // overlap (see storybook of this component).
        const HEIGHT_CORRECTION_FACTOR = 0.74

        const textHeight = max(lines.map((line) => line.height)) ?? 0
        const correctedTextHeight = textHeight * HEIGHT_CORRECTION_FACTOR
        const containerHeight = lineHeight * fontSize
        const yOffset =
            y + (containerHeight - (containerHeight - correctedTextHeight) / 2)

        return [x, yOffset]
    }

    render(
        x: number,
        y: number,
        {
            textProps,
            id,
        }: { textProps?: React.SVGProps<SVGTextElement>; id?: string } = {}
    ): React.ReactElement {
        const {
            props,
            lines,
            fontSize,
            fontWeight,
            lineHeight,
            firstLineOffset,
        } = this

        if (lines.length === 0) return <></>

        const [correctedX, correctedY] = this.getPositionForSvgRendering(x, y)

        return (
            <text
                id={id}
                fontSize={fontSize.toFixed(2)}
                fontWeight={fontWeight}
                x={correctedX.toFixed(1)}
                y={correctedY.toFixed(1)}
                {...textProps}
            >
                {lines.map((line, i) => {
                    const x = correctedX + (i === 0 ? firstLineOffset : 0)
                    const y = correctedY + lineHeight * fontSize * i

                    if (props.rawHtml)
                        return (
                            <tspan
                                key={i}
                                x={x}
                                y={y}
                                dangerouslySetInnerHTML={{ __html: line.text }}
                            />
                        )
                    else
                        return (
                            <tspan key={i} x={x} y={y}>
                                {line.text}
                            </tspan>
                        )
                })}
            </text>
        )
    }
}
