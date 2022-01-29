const { normalCopyOf } = require("dcc-business-rules-utils")
const { join } = require("path")

const { mkDir, writeJson } = require("./file-utils")
const { groupBy, sortBy } = require("./func-utils")
const { renderAsText } = require("./render-expression-as-text")
const { parseId } = require("./rules-utils")


const allRules = require("../tmp/all-rules.json")


const rulesPerCountry = groupBy(allRules, (rule) => parseId(rule.Identifier).c)

const normalised = (rule) => {
    const copy = normalCopyOf(rule)
    copy["expr-as-text"] = renderAsText(rule.Logic)
    return copy
}

for (const c in rulesPerCountry) {
    const countryPath = join("per-country", c)
    mkDir(countryPath)
    Object.entries(
        groupBy(rulesPerCountry[c], (rule) => rule.Identifier)
    ).forEach(([ id, ruleVersions ]) => {
        const { t, n } = parseId(id)
        const sortedRuleVersions = sortBy(ruleVersions, (ruleVersion) => ruleVersion.Version).reverse()
        writeJson(join(countryPath, `${t}-${n}.json`), sortedRuleVersions.map((ruleVersion) => normalised(ruleVersion)))
    })
}

writeJson(
    "analysis/n-rules-per-country.json",
    Object.entries(rulesPerCountry)
        .map(([ co, rules ]) =>
            ({
                co,
                n: rules.length,
                nAcceptance: rules.filter((rule) => rule.Type === "Acceptance").length,
                nInvalidation: rules.filter((rule) => rule.Type === "Invalidation").length
            })
        )
)

