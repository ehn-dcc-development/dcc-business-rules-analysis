import {CertLogicExpression, evaluate} from "certlogic-js"
import {Rule} from "dcc-business-rules-utils"
const deepEqual = require("deep-equal")

import {dateWithOffset} from "./utils/date-utils"
import {lowerTriangular, range, groupBy} from "./utils/func-utils"
import {rle} from "./utils/rle-util"
import {vaccineIds} from "./refData/vaccine-data"
import {ComboInfo, SimpleComboInfo, VaccineSpec} from "./json-files"

const valueSets = require("../src/refData/valueSets.json")


const inputDataFrom = (mp: string, dt: string, dn: number, sd: number, nowDate: string): any =>
    ({
        payload: {
            v: [
                {
                    mp, dt, dn, sd,
                    tg: valueSets["disease-agent-targeted"][0],
                    ma: valueSets["vaccines-covid-19-auth-holders"][0],
                    vp: valueSets["sct-vaccines-covid-19"][0],
                }
            ],
            dob: "2000-01-01"   // for LT
        },
        external: {
            valueSets,
            validationClock: `${nowDate}T13:37:00Z` // somewhere middle of the day
        }
    })


const safeEvaluate = (expr: CertLogicExpression, data: unknown): any => {
    try {
        return evaluate(expr, data)
    } catch (e: any) {
        // to warn on the console:
        console.error(`exception thrown during evaluation of CertLogic expression: ${e.message}`)
        // for logging:
        console.log(`exception thrown during evaluation of CertLogic expression: ${e.message}`)
        console.dir(expr)
        console.dir(data)
        throw new Error(`stop`)
    }
}

const acceptedByVaccineRules = (rules: Rule[], mp: string, dt: string, dn: number, sd: number, nowDate: string): boolean =>
    Object.values(
        groupBy(rules, (rule) => rule.Identifier)
    ).every((ruleVersions) => {
        const applicableRuleVersions = ruleVersions.filter((ruleVersion) =>
            new Date(ruleVersion.ValidFrom) <= new Date(nowDate) && new Date(nowDate) < new Date(ruleVersion.ValidTo)
        )
        if (applicableRuleVersions.length === 0) {
            // This can happen rather often/easily, e.g. when a rule has a window of validity (across all its versions) shorter than 2 years.
            return true
        }
        const applicableRuleVersion = applicableRuleVersions.reduce((acc, cur) => acc.Version > cur.Version ? acc : cur)
        try {
            const result = safeEvaluate(applicableRuleVersion.Logic, inputDataFrom(mp, dt, dn, sd, nowDate))
            if (typeof result !== "boolean") {
                console.warn(`evaluation of rule's logic (on next line) yielded a non-boolean: ${result} - (returning false)`)
                console.dir(applicableRuleVersion.Logic)
                return false
            }
            return result
        } catch (e) {
            console.log(`occurred during evaluation of rule with ID "${applicableRuleVersion.Identifier}" and version ${applicableRuleVersion.Version}`)
            throw new Error(`stop`)
        }
    })


const infoForCombo = (rules: Rule[], co: string, mp: string, dn: number, sd: number): ComboInfo => {
    const validFrom = "2022-03-01"
    const justOverTwoYears = range(2*366 + 1)
    const acceptance = justOverTwoYears.map((nDays) =>
        acceptedByVaccineRules(rules, mp, validFrom, dn, sd, dateWithOffset(validFrom, nDays))
    )
    const rleAcceptance = rle(acceptance)

    const checkValidFrom = "2022-05-01"
    const checkAcceptance = justOverTwoYears.map((nDays) =>
        acceptedByVaccineRules(rules, mp, checkValidFrom, dn, sd, dateWithOffset(checkValidFrom, nDays))
    )
    const checkRleAcceptance = rle(checkAcceptance)
    const translationInvariant = deepEqual(rleAcceptance, checkRleAcceptance)
    if (!translationInvariant) {
        console.log(`[WARNING] business rules for country "${co}", vaccine "${mp}", and ${dn}/${sd} are not invariant under datetime translations!`)
    }

    const wrapForInInvariance = (value: SimpleComboInfo): ComboInfo =>
        translationInvariant
            ? value
            : ({
                $translationInvariant: false,
                value
            })

    switch (rleAcceptance.length) {
        case 1: return wrapForInInvariance(null) // not accepted
        case 2: return wrapForInInvariance(rleAcceptance[0])
        case 3: return wrapForInInvariance([ rleAcceptance[0], rleAcceptance[1] ])
        default: {
            console.log(`[WARN] unexpected RLE for rules of ${co}, vaccine "${mp}", ${dn}/${sd}: ${rleAcceptance} - truncating to 2 entries`)
            return wrapForInInvariance([ rleAcceptance[0], rleAcceptance[1] ])
        }
    }
}


const specForVaccine = (rules: Rule[], co: string, mp: string): VaccineSpec => ({
    vaccineIds: [mp],
    combos: Object.fromEntries(
        lowerTriangular(6).map(([ i, j ]) =>
            [ `${i+1}/${j+1}`, infoForCombo(rules, co, mp, i + 1, j + 1) ]
        )
    )
})


const isNotAccepted = (vaccineSpec: VaccineSpec): boolean =>
    Object.values(vaccineSpec.combos).every((comboValue) => comboValue === null)
const removeUnaccepted = (vaccineSpecs: VaccineSpec[]): VaccineSpec[] =>
    vaccineSpecs.filter((vaccineSpec) => !isNotAccepted(vaccineSpec))


const dedupEqualSpecs = (vaccineSpecs: VaccineSpec[]): VaccineSpec[] => {
    const dedupped: VaccineSpec[] = []
    for (const vaccineSpec of vaccineSpecs) {
        const dedupCandidate = dedupped.find((candidate) => deepEqual(candidate.combos, vaccineSpec.combos))
        if (dedupCandidate) {
            dedupCandidate.vaccineIds.push(...vaccineSpec.vaccineIds)
        } else {
            dedupped.push(vaccineSpec)
        }
    }
    return dedupped
}


const optimise = (vaccineSpecs: VaccineSpec[]): VaccineSpec[] =>
    dedupEqualSpecs(removeUnaccepted(vaccineSpecs))


export const vaccineSpecsFromRules = (rules: Rule[], co: string): VaccineSpec[] =>
    optimise(
        vaccineIds.map((mp) => specForVaccine(rules, co, mp))
    )

