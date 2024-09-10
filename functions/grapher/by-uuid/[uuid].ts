import { Env } from "../../_common/env.js"
import { fetchGrapherConfig } from "../../_common/grapherRenderer.js"
import { IRequestStrict, Router, error, StatusError } from "itty-router"
import { handleThumbnailRequest } from "../../_common/reusableHandlers.js"
import { extensions } from "../[slug].js"

const router = Router<IRequestStrict, [URL, Env, string]>()
router
    .get(
        `/grapher/by-uuid/:uuid${extensions.configJson}`,
        async ({ params: { uuid } }, { searchParams }, env, etag) =>
            handleConfigRequest(uuid, searchParams, env, etag)
    )
    .get(
        `/grapher/by-uuid/:uuid${extensions.png}`,
        async ({ params: { uuid } }, { searchParams }, env, etag, ctx) =>
            handleThumbnailRequest(
                { type: "uuid", id: uuid },
                searchParams,
                env,
                etag,
                ctx,
                "png"
            )
    )
    .get(
        `/grapher/by-uuid/:uuid${extensions.svg}`,
        async ({ params: { uuid } }, { searchParams }, env, etag, ctx) =>
            handleThumbnailRequest(
                { type: "uuid", id: uuid },
                searchParams,
                env,
                etag,
                ctx,
                "svg"
            )
    )
    .all("*", () => error(404, "Route not defined"))

export const onRequest: PagesFunction = async (context) => {
    const { request, env } = context
    const url = new URL(request.url)

    return router
        .fetch(
            request,
            url,
            { ...env, url },
            request.headers.get("if-none-match"),
            context
        )
        .catch((e) => {
            if (e instanceof StatusError) {
                return error(e.status, e.message)
            }

            return error(500, e)
        })
}

async function handleConfigRequest(
    uuid: string,
    searchParams: URLSearchParams,
    env: Env,
    etag: string | undefined
) {
    const shouldCache = searchParams.get("nocache") === null
    console.log("Preparing json response for uuid ", uuid)

    const grapherPageResp = await fetchGrapherConfig(
        { type: "uuid", id: uuid },
        env,
        etag
    )

    if (grapherPageResp.status === 304) {
        return new Response(null, { status: 304 })
    }

    console.log("Grapher page response", grapherPageResp.grapherConfig.title)

    const cacheControl = shouldCache
        ? "public, s-maxage=3600, max-age=0, must-revalidate"
        : "public, s-maxage=0, max-age=0, must-revalidate"

    return Response.json(grapherPageResp.grapherConfig, {
        headers: {
            "content-type": "application/json",
            "Cache-Control": cacheControl,
            ETag: grapherPageResp.etag,
        },
    })
}
