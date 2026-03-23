/* backend/utils/gpaCalculator.js */

const gradeMap = {
    'O': 10, 'A+': 9, 'A': 8, 'B+': 7,
    'B': 6, 'C': 5, 'U': 0, 'RA': 0,
    'AB': 0, 'F': 0
};

const failedGrades = ['U', 'RA', 'AB', 'F'];

const calculateStudentStats = (allResults) => {
    let semesterSGPAs = {};
    let subjectHistory = {};
    let everFailed = false;

    // ---------- 1. SGPA + Subject History ----------
    allResults.forEach(result => {
        let semPoints = 0;
        let semCredits = 0;

        result.subjects.forEach(sub => {
            // Track subject history
            if (!subjectHistory[sub.code]) {
                subjectHistory[sub.code] = [];
            }
            subjectHistory[sub.code].push({
                semester: result.semester,
                grade: sub.grade,
                credits: sub.credits,
                name: sub.name,
                year: sub.year // Added year for completeness if available
            });

            // Detect ANY failure (for NHA)
            if (failedGrades.includes(sub.grade)) {
                everFailed = true;
            }

            // SGPA calculation
            const points = gradeMap[sub.grade] ?? 0;
            const credits = sub.credits ?? 0;

            semPoints += points * credits;
            semCredits += credits;
        });

        semesterSGPAs[result.semester] =
            semCredits === 0 ? 0 : Number((semPoints / semCredits).toFixed(2));
    });

    // ---------- 2. CGPA + Standing Arrears ----------
    let totalPoints = 0;
    let totalCredits = 0;
    let standingArrears = [];

    Object.keys(subjectHistory).forEach(code => {
        const attempts = subjectHistory[code];

        // Prefer a PASSED attempt (latest pass)
        // We look for the *last* attempt that is NOT a failure
        // If multiple passes exist, usually best or latest counts. Here we take latest pass.
        const passedAttempt = [...attempts]
            .reverse()
            .find(a => !failedGrades.includes(a.grade));

        // If never passed, use the latest attempt (which is a fail)
        const finalAttempt = passedAttempt || attempts[attempts.length - 1];

        const points = gradeMap[finalAttempt.grade] ?? 0;
        const credits = finalAttempt.credits ?? 0;

        // CGPA only counts the "definitive" attempt for that subject
        totalPoints += points * credits;
        totalCredits += credits;

        // Standing arrear = latest attempt is failure
        const latest = attempts[attempts.length - 1];
        if (failedGrades.includes(latest.grade)) {
            standingArrears.push({
                code,
                name: latest.name,
                grade: latest.grade,
                attempts: attempts.length
            });
        }
    });

    const cgpa = totalCredits === 0
        ? 0
        : Number((totalPoints / totalCredits).toFixed(2));

    // ---------- 3. Academic Status ----------
    const saCount = standingArrears.length;
    const nha = !everFailed;
    // NSA (No Standing Arrear) means they have history of failure but cleared it.
    // So if NHA is true, NSA is "Not applicable" or strictly false in this definition context?
    // Usually systems report: Status: "Good" (NHA), "Cleared" (NSA), "Arrears" (SA).
    const nsa = !nha && saCount === 0;

    return {
        sgpa: semesterSGPAs,
        cgpa,
        sa: standingArrears,
        saCount,
        nha,
        nsa,
        attempts: Object.fromEntries(
            Object.entries(subjectHistory).map(([code, arr]) => [code, arr.length])
        )
    };
};

module.exports = { calculateStudentStats };
