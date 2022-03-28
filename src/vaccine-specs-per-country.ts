import {applicableRuleVersions, Rule} from "dcc-business-rules-utils"
const deepEqual = require("deep-equal")

import {lowerTriangular} from "./utils/func-utils"
import {vaccineIds} from "./refData/vaccine-data"
import {ComboInfo, VaccineSpec} from "./json-files"
import {
    inputDataFor,
    Replacement,
    replaceSubExpression
} from "./analyser/helpers"
import {pretty, readJson} from "./utils/file-utils"
import {and_} from "certlogic-js/dist/factories"
import {
    CLExtExpr,
    isCertLogicExpression,
    Unknown
} from "./reducer/extended-types"
import {evaluatePartially} from "./reducer/partial-evaluator"
import {analyse} from "./analyser/analyser"
import {isUnanalysable, validityAsCombo} from "./analyser/types"



const validationClock = new Date()
validationClock.setMonth(validationClock.getMonth() + 1)
console.log(`verification timestamp ('validationClock'): ${validationClock.toISOString()}`)


const replacementsPerCountry: { [country: string]: Replacement[] } = readJson("src/analyser/replacements.json")

const infoForCombo = (exprForVaccine: CLExtExpr, mp: string, dn: number, sd: number): ComboInfo => {
    const reducedExpr = evaluatePartially(exprForVaccine, inputDataFor(dn, sd, mp))
    if (!isCertLogicExpression(reducedExpr)) {
        console.error(`not reducible: ${pretty(reducedExpr)}`)
        throw new Error(`Acceptance rules didn't reduce to a CertLogic expression with dn/sd=${dn}/${sd} and mp="${mp}"`)
    }
    const validity = analyse(reducedExpr)
    if (isUnanalysable(validity)) {
        console.error(`reduced CertLogic expression: ${pretty(reducedExpr)}`)
        console.error(`(attempt@)analysis: ${pretty(validity)}`)
        throw new Error(`reduced CertLogic expression could not be fully analysed, i.e. reduced to an instance of Validity`)
    }
    return validityAsCombo(validity)
}


const specForVaccine = (combinedLogicForCountry: CLExtExpr, mp: string): VaccineSpec => {
    const exprForVaccine = evaluatePartially(combinedLogicForCountry, inputDataFor(Unknown, Unknown, mp))
    return {
        vaccineIds: [mp],
        combos: Object.fromEntries(
            lowerTriangular(6).map(([ i, j ]) =>
                [ `${i+1}/${j+1}`, infoForCombo(exprForVaccine, mp, i + 1, j + 1) ]
            )
        )
    }
}


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


export const vaccineSpecsFromRules = (rules: Rule[], co: string): VaccineSpec[] => {
    console.log(`\tcountry=${co}`)
    const andCertLogicExpr = and_(
        ...applicableRuleVersions(rules, co, "Acceptance", validationClock)
            .map((rule) => rule.Logic)
    )  // and(...all applicable versions of Acceptance rules...)
    /*
     * [DEBUG]
    if (co in replacementsPerCountry) {
        const replacedExpr = replaceSubExpression(andCertLogicExpr, replacementsPerCountry[co])
        if (!deepEqual(andCertLogicExpr, replacedExpr)) {
            console.log(`${co} has replacements; replaced expression:`)
            console.log(pretty(replacedExpr))
        }
    }
     */
    const combinedLogicForCountry = evaluatePartially(
        co in replacementsPerCountry
            ? replaceSubExpression(andCertLogicExpr, replacementsPerCountry[co])
            : andCertLogicExpr,
        inputDataFor(Unknown, Unknown, Unknown)
    )
    return optimise(
        vaccineIds.map((mp) => specForVaccine(combinedLogicForCountry, mp))
    )
}

