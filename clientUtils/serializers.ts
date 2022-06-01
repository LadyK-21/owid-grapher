const jsonCommentDelimiter = "\n//EMBEDDED_JSON\n"
// Stringifies JSON for placing into an arbitrary doc, for later extraction without parsing the whole doc
export const serializeJSONForHTML = (
    obj: Record<string, unknown>,
    delimiter = jsonCommentDelimiter
): string =>
    `${delimiter}${
        obj === undefined ? "" : JSON.stringify(obj, null, 2)
    }${delimiter}`
export const deserializeJSONFromHTML = (
    html: string,
    delimiter = jsonCommentDelimiter
): any => {
    const json = html.split(delimiter)[1]
    return json === undefined || json === "" ? undefined : JSON.parse(json)
}
