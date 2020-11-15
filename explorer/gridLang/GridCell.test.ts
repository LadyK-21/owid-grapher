#! /usr/bin/env yarn jest

import { GridCell } from "explorer/gridLang/GridCell"
import {
    CellDef,
    CellHasErrorsClass,
    FrontierCellClass,
    KeywordMap,
    RootKeywordCellDef,
    StringCellDef,
} from "explorer/gridLang/GridLangConstants"
import { tsvToMatrix } from "./GrammarUtils"

const TestGrammarRootKeywordMap: KeywordMap = {
    title: {
        ...StringCellDef,
        keyword: "title",
        placeholder: "A whole new world",
        description: "Some description",
    },
} as const

const TestGrammar: CellDef = {
    ...RootKeywordCellDef,
    keywordMap: TestGrammarRootKeywordMap,
}

describe(GridCell, () => {
    it("can parse a cell", () => {
        const cell = new GridCell(
            tsvToMatrix(`title\tHello world`),
            0,
            1,
            TestGrammar
        )
        expect(cell.errorMessage).toEqual(``)
        expect(cell.comment).toContain(
            TestGrammarRootKeywordMap.title.description
        )
        expect(cell.cssClasses).toContain(StringCellDef.cssClass)
        expect(cell.placeholder).toBeFalsy()
    })

    it("can show a placeholder", () => {
        const cell = new GridCell(tsvToMatrix(`title`), 0, 1, TestGrammar)
        expect(cell.placeholder).toBeTruthy()
    })

    it("uses the keyword definition for the first cell instead of abstract keyword", () => {
        const cell = new GridCell(
            tsvToMatrix(`title\tHello world`),
            0,
            0,
            TestGrammar
        )
        expect(cell.comment).toContain(
            TestGrammarRootKeywordMap.title.description
        )
    })

    it("can insert a css class to show the user a + button", () => {
        expect(
            new GridCell(tsvToMatrix(`title\tHello world`), 1, 0, TestGrammar)
                .cssClasses
        ).toContain(FrontierCellClass)
        expect(
            new GridCell(tsvToMatrix(``), 1, 0, TestGrammar).cssClasses
        ).not.toContain(FrontierCellClass)
    })

    it("can detect errors", () => {
        const cell = new GridCell(
            tsvToMatrix(`tile\tHello world`),
            0,
            0,
            TestGrammar
        )
        expect(cell.errorMessage).not.toEqual(``)
        expect(cell.cssClasses).toContain(CellHasErrorsClass)
    })
})
