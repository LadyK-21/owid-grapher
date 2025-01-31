import { DataSource } from "typeorm"
import {
    GRAPHER_DB_HOST,
    GRAPHER_DB_NAME,
    GRAPHER_DB_USER,
    GRAPHER_DB_PASS,
    GRAPHER_DB_PORT,
} from "../settings/serverSettings.js"

export const dataSource = new DataSource({
    type: "mysql",
    host: GRAPHER_DB_HOST || "localhost",
    port: GRAPHER_DB_PORT || 3306,
    username: GRAPHER_DB_USER || "root",
    password: GRAPHER_DB_PASS || "",
    database: GRAPHER_DB_NAME,
    entities: ["db/model/**/!(*.test).ts"],
    migrations: ["db/migration/**/!(*.test).ts"],
    charset: "utf8mb4",
    connectorPackage: "mysql2",
    extra: {
        // Instruct the mysql2 driver to not convert json columns to a JS object implicitly; many
        // of our migrations rely on the raw JSON string
        jsonStrings: true,
    },
})
