const { evaluate } = require("certlogic-js")
const deepEqual = require("deep-equal")

const { rle } = require("./rle-util")
const { lowerTriangular, range } = require("./func-utils")

const valueSets = require("./valueSets.json")


const inputDataFrom = (mp, dt, dn, sd, nowDate) =>
    ({
        payload: {
            v: [
                {
                    mp, dt, dn, sd,
                    tg: valueSets["disease-agent-targeted"][0],
                    ma: valueSets["vaccines-covid-19-auth-holders"][0],
                    vp: valueSets["sct-vaccines-covid-19"][0]
                }
            ]
        },
        external: {
            valueSets,
            validationClock: `${nowDate}T13:37:00Z` // somewhere middle of the day
        }
    })


const safeEvaluate = (expr, data) => {
    try {
        return evaluate(expr, data)
    } catch (e) {
        // to warn on the console:
        console.error(`exception thrown during evaluation of CertLogic expression: ${e.message}`)
        // for logging:
        console.log(`exception thrown during evaluation of CertLogic expression: ${e.message}`)
        console.dir(expr)
        console.dir(data)
    }
}

const acceptedByVaccineRules = (rules, mp, dt, dn, sd, nowDate) =>
    rules.every((rule) => safeEvaluate(rule, inputDataFrom(mp, dt, dn, sd, nowDate)))


const dateWithOffset = (dateStr, nDays) => {
    const date = new Date(dateStr)
    date.setUTCDate(date.getUTCDate() + nDays)
    return date.toISOString().substring(0, "dd-mm-yyyy".length)
}


const infoForCombo = (rules, co, mp, dn, sd) => {
    const validFrom = "2022-01-01"
    const justOverTwoYears = range(2*366 + 1)
    const acceptance = justOverTwoYears.map((nDays) =>
        acceptedByVaccineRules(rules, mp, validFrom, dn, sd, dateWithOffset(validFrom, nDays))
    )
    const rleAcceptance = rle(acceptance)

    const checkValidFrom = "2022-03-01"
    const checkAcceptance = justOverTwoYears.map((nDays) =>
        acceptedByVaccineRules(rules, mp, checkValidFrom, dn, sd, dateWithOffset(checkValidFrom, nDays))
    )
    const checkRleAcceptance = rle(checkAcceptance)
    const translationInvariant = deepEqual(rleAcceptance, checkRleAcceptance)
    if (!translationInvariant) {
        console.log(`[WARNING] business rules for country "${co}", vaccine "${mp}", and ${dn}/${sd} are not invariant under datetime translations!`)
    }

    const wrapForInInvariance = (value) =>
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
        default: throw new Error(`unexpected RLE: ${rleAcceptance}`)
    }
}


const infoForVaccine = (rules, co, mp) => ({
    vaccineIds: [mp],
    combos: Object.fromEntries(
        lowerTriangular(6).map(([ i, j ]) =>
            [ `${i+1}/${j+1}`, infoForCombo(rules, co, mp, i + 1, j + 1) ]
        )
    )
})


const isNotAccepted = (vaccineInfo) =>
    Object.values(vaccineInfo.combos).every((comboValue) => comboValue === null)
const removeUnaccepted = (countryInfo) =>
    countryInfo.filter((vaccineInfo) => !isNotAccepted(vaccineInfo))


const dedupEqualSpecs = (countryInfo) => {
    const dedupped = []
    for (const vaccineInfo of countryInfo) {
        const dedupCandidate = dedupped.find((candidate) => deepEqual(candidate.combos, vaccineInfo.combos))
        if (dedupCandidate) {
            dedupCandidate.vaccineIds.push(...vaccineInfo.vaccineIds)
        } else {
            dedupped.push(vaccineInfo)
        }
    }
    return dedupped
}


const optimise = (countryInfo) =>
    dedupEqualSpecs(removeUnaccepted(countryInfo))


const vaccineIds = valueSets["vaccines-covid-19-names"]

const vaccineSpecsFromRules = (rules, co) =>
    optimise(
        vaccineIds.map((mp) => infoForVaccine(rules, co, mp))
    )
module.exports.vaccineSpecsFromRules = vaccineSpecsFromRules
