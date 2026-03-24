require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const Student = require('./models/Student');
const Result = require('./models/Result');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// MongoDB connection (Handled at the bottom for sequence control)
const dbUri = process.env.MONGO_URI;


// Routes
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    // Admin check
    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        return res.json({ role: 'admin', userId: 'admin' });
    }

    try {
        let student = await Student.findOne({ id: username });
        if (!student) {
            // Check if student exists in SheetData (fallback for sync issues)
            // Allow login if password matches username (default first-time credential)
            if (password === username) {
                const sheetRecord = await SheetData.findOne({
                    $or: [
                        { "data.regno": username },
                        { "data.RegNo": username },
                        { "data.REGNO": username },
                        { "data.register": username },
                        { "data.Register": username },
                        { "data.id": username },
                        { "data.ID": username }
                    ]
                });

                if (sheetRecord) {
                    const row = sheetRecord.data;
                    const findVal = (keys) => {
                        for (const k of keys) {
                            if (row[k]) return row[k];
                            const descriptor = Object.keys(row).find(rk => rk.toLowerCase().replace(/[^a-z0-9]/g, '') === k);
                            if (descriptor) return row[descriptor];
                        }
                        return null;
                    };

                    const name = findVal(['name', 'studentname']) || 'Unknown Student';
                    const semester = findVal(['semester', 'sem']);

                    const hashedPassword = await bcrypt.hash(username, 10);
                    student = new Student({
                        id: username,
                        name: name,
                        semester: semester ? parseInt(semester) : 1,
                        password: hashedPassword,
                        isFirstLogin: true
                    });
                    await student.save();
                }
            }
        }

        if (!student) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Compare password (hashed or fallback to plain text for transition)
        let isMatch = false;
        if (student.password.startsWith('$2a$') || student.password.startsWith('$2b$')) {
            isMatch = await bcrypt.compare(password, student.password);
        } else {
            isMatch = student.password === password;
        }

        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        res.json({
            role: 'student',
            userId: student.id,
            isFirstLogin: student.isFirstLogin
        });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/students', async (req, res) => {
    try {
        const students = await Student.find();
        res.json(students);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/students', async (req, res) => {
    const student = new Student(req.body);
    try {
        const newStudent = await student.save();
        res.status(201).json(newStudent);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

app.delete('/api/students/:id', async (req, res) => {
    try {
        await Student.findOneAndDelete({ id: req.params.id });
        res.json({ message: 'Student deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/results', async (req, res) => {
    try {
        const results = await Result.find();
        res.json(results);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/results/:studentId', async (req, res) => {
    try {
        const results = await Result.find({ studentId: req.params.studentId });
        res.json(results);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/results', async (req, res) => {
    const result = new Result(req.body);
    try {
        const newResult = await result.save();
        res.status(201).json(newResult);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// File Upload Configuration
const fs = require('fs');
const multer = require("multer");
const XLSX = require("xlsx");
const { v4: uuidv4 } = require("uuid");
const Upload = require("./models/Upload");
const SheetData = require("./models/SheetData");
const Course = require("./models/Course");

// Ensure uploads directory exists
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ storage: storage });

// Upload and Parse Spreadsheet Route
app.post("/api/upload-courses", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    try {
        console.log(`Processing course upload: ${req.file.path}`);
        const filePath = req.file.path;

        let workbook;
        try {
            workbook = XLSX.readFile(filePath);
        } catch (readErr) {
            console.error("Error reading Excel file:", readErr);
            return res.status(400).json({ message: "Failed to read Excel file. Ensure it is a valid .xlsx file." });
        }

        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet);

        if (rows.length === 0) {
            return res.status(400).json({ message: "Sheet is empty" });
        }

        console.log(`Found ${rows.length} rows in course sheet.`);
        console.log("Sample keys of first row:", Object.keys(rows[0]));

        const batchId = uuidv4();

        // Save metadata
        await Upload.create({
            batchId,
            fileName: req.file.originalname,
            uploadedBy: "admin" // Hardcoded for now, waiting for auth middleware
        });

        // Attach batchId to each row and prepare for bulk insert
        const documents = rows.map(row => ({
            batchId,
            data: row // Store the raw row data in a flexible field
        }));

        await SheetData.insertMany(documents);

        const coursesToUpsert = [];
        for (const row of rows) {
            const getValue = (keys) => {
                const rowKeys = Object.keys(row);
                for (const originalK of keys) {
                    // Try exact match first (case-insensitive)
                    const exactKey = rowKeys.find(rk => rk.trim().toLowerCase() === originalK.trim().toLowerCase());
                    if (exactKey) return row[exactKey];

                    // Fallback to stripped key
                    const k = originalK.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const foundKey = rowKeys.find(rk => rk.toLowerCase().replace(/[^a-z0-9]/g, '') === k);
                    if (foundKey) return row[foundKey];
                }
                return null;
            };

            const code = getValue(['Course Cod', 'Course Code', 'coursecode', 'code', 'subjectcode', 'subject', 'c', 'id']);
            const name = getValue(['Course Title', 'coursename', 'name', 'subjectname', 'title', 'course']);
            const credits = getValue(['Credits (C)', 'Credits(C)', 'credits', 'credit', 'creditpoints', 'points', 'hours', 'crdt', 'cr']);

            console.log(`Extracted -> Code: ${code}, Name: ${name}, Credits: ${credits}, Raw Credits: ${JSON.stringify(credits)}`);

            // Validate fields
            if (code && (credits !== undefined && credits !== null)) {
                const parsedCredits = Number(credits);
                if (!isNaN(parsedCredits)) {
                    coursesToUpsert.push({
                        updateOne: {
                            filter: { code: String(code).toUpperCase().trim() },
                            update: {
                                $set: {
                                    title: name ? String(name).trim() : String(code).toUpperCase(),
                                    credits: parsedCredits
                                }
                            },
                            upsert: true
                        }
                    });
                }
            }
        }

        if (coursesToUpsert.length > 0) {
            console.log(`Upserting ${coursesToUpsert.length} courses...`);
            await Course.bulkWrite(coursesToUpsert);
            console.log("Course upsert complete.");

            // Recalculate CGPA for all existing results based on updated course credits
            console.log("Recalculating credits and GPAs for all existing results...");
            const allCourses = await Course.find();
            const courseMap = new Map();
            allCourses.forEach(c => courseMap.set(c.code.toUpperCase(), c));

            const allResults = await Result.find();
            const gradeMap = { 'O': 10, 'A+': 9, 'A': 8, 'B+': 7, 'B': 6, 'C': 5, 'U': 0, 'RA': 0, 'AB': 0, 'F': 0 };
            let updatedResultsCount = 0;

            for (const result of allResults) {
                let isModified = false;
                let totalPoints = 0;
                let totalCredits = 0;

                for (let i = 0; i < result.subjects.length; i++) {
                    const sub = result.subjects[i];
                    if (!sub || !sub.code) continue;

                    const rawSubCode = String(sub.code).toUpperCase().trim();
                    const cleanSubCode = rawSubCode.split('-')[0].trim();
                    const currentCourse = courseMap.get(cleanSubCode);

                    if (currentCourse) {
                        if (sub.credits !== currentCourse.credits || sub.name !== currentCourse.title || String(sub.code) !== cleanSubCode) {
                            sub.credits = currentCourse.credits;
                            sub.name = currentCourse.title; // Update name
                            sub.code = currentCourse.code || cleanSubCode;
                            isModified = true;
                        }
                    }

                    const grade = String(sub.grade).toUpperCase();
                    const points = gradeMap[grade] || 0;
                    const credit = Number(sub.credits) || 0;

                    totalPoints += points * credit;
                    totalCredits += credit;
                }

                const calculatedGPA = totalCredits > 0 ? Number((totalPoints / totalCredits).toFixed(2)) : 0;

                if (calculatedGPA !== result.gpa) {
                    result.gpa = calculatedGPA;
                    isModified = true;
                }

                if (isModified) {
                    // Mark subjects modified explicitly for Mongoose array changes just in case
                    result.markModified('subjects');
                    await result.save();
                    updatedResultsCount++;
                }
            }

            if (updatedResultsCount > 0) {
                console.log(`Updated ${updatedResultsCount} results with new credits/GPA...`);
            }

            res.json({ message: `Successfully processed ${coursesToUpsert.length} courses.`, batchId });

        } else {
            console.warn("No valid course rows found.");

            let debugInfo = "None";
            if (rows.length > 0) {
                const firstRow = rows[0];
                debugInfo = `Keys: [${Object.keys(firstRow).join(', ')}]`;
            }

            res.status(400).json({ message: `No valid course data found. Details: ${debugInfo}` });
        }
    } catch (err) {
        console.error("Course Upload fatal error:", err);
        res.status(500).json({ message: `Server Error: ${err.message}` });
    } finally {
        // ALWAYS safely delete the temporary file precisely once, regardless of return path!
        if (req.file && filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) { }
        }
    }
});

// Upload and Parse Spreadsheet Route
app.post("/api/upload", upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
    }

    try {
        const { semester: bodySemester } = req.body;
        console.log(`Uploading results. Received body semester: ${bodySemester}`);

        const filePath = req.file.path;
        const workbook = XLSX.readFile(filePath);
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            fs.unlinkSync(filePath);
            return res.status(400).json({ message: "No sheets found in Excel file" });
        }

        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Convert to JSON
        const rows = XLSX.utils.sheet_to_json(sheet);
        console.log(`Processing ${rows.length} rows from Excel sheet.`);

        // Pre-fetch all courses for credit lookup
        const allCourses = await Course.find();
        const courseMap = new Map();
        allCourses.forEach(c => {
            if (c.code) courseMap.set(c.code.toUpperCase().trim(), c);
        });

        if (rows.length === 0) {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return res.status(400).json({ message: "Sheet is empty" });
        }

        const batchId = uuidv4();

        // Save metadata
        await Upload.create({
            batchId,
            fileName: req.file.originalname,
            uploadedBy: "admin"
        });

        // Attach batchId to each row and prepare for bulk insert
        const documents = rows.map(row => ({
            batchId,
            data: row
        }));

        await SheetData.insertMany(documents);

        // Process rows to create/update Student users and Results
        const studentsToUpsert = [];
        const resultsToUpsert = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            // Helper to find key case-insensitively
            const getValue = (keys) => {
                const rowKeys = Object.keys(row);
                for (const originalK of keys) {
                    const k = originalK.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const foundKey = rowKeys.find(rk => rk.toLowerCase().replace(/[^a-z0-9]/g, '') === k);
                    if (foundKey) return row[foundKey];
                }
                return null;
            };

            const regNo = getValue(['regno', 'registernumber', 'register', 'id']);
            const name = getValue(['name', 'studentname']);
            // Priority: Row data semester > Body override > Default 1
            const rowSemester = getValue(['semester', 'sem']);
            const semesterStr = rowSemester || bodySemester;
            const semester = parseInt(semesterStr) || 1;

            if (i === 0) {
                console.log(`First row parsed - Student: ${regNo}, Sem extracted: ${semesterStr}, Final Semester: ${semester}`);
            }

            if (regNo) {
                // 1. Prepare Student Upsert
                const studentId = String(regNo).trim();
                const hashedPassword = await bcrypt.hash(studentId, 10);

                const updateFields = {
                    semester: semester
                };
                
                const setOnInsertFields = {
                    id: studentId,
                    password: hashedPassword,
                    isFirstLogin: true
                };

                if (name) {
                    updateFields.name = String(name).trim();
                } else {
                    setOnInsertFields.name = 'Unknown Student';
                }

                studentsToUpsert.push({
                    updateOne: {
                        filter: { id: studentId },
                        update: {
                            $set: updateFields,
                            $setOnInsert: setOnInsertFields
                        },
                        upsert: true
                    }
                });

                // 2. Parse Results (Subjects)
                const ignoreKeys = ['regno', 'registernumber', 'register', 'id', 'name', 'studentname', 'semester', 'sem', 'sno', 'total', 'gpa', 'cgpa', 'sgpa'];
                const subjectKeys = Object.keys(row).filter(key => {
                    const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
                    return !ignoreKeys.includes(cleanKey);
                });

                const gradeMap = { 'O': 10, 'A+': 9, 'A': 8, 'B+': 7, 'B': 6, 'C': 5, 'U': 0, 'RA': 0, 'AB': 0, 'F': 0 };
                const subjects = [];
                let totalPoints = 0;
                let totalCredits = 0;

                for (const key of subjectKeys) {
                    const val = row[key];
                    if (val !== undefined && val !== null && val !== '') {
                        const rawCode = key.toUpperCase().trim();
                        const cleanCode = rawCode.split('-')[0].trim();
                        const currentCourse = courseMap.get(cleanCode);
                        const courseCredit = currentCourse ? currentCourse.credits : 0;
                        const courseName = currentCourse ? currentCourse.title : key;
                        const grade = String(val).toUpperCase().trim();

                        subjects.push({
                            code: currentCourse ? currentCourse.code : cleanCode,
                            name: courseName,
                            marks: typeof val === 'number' ? val : 0,
                            grade: grade,
                            credits: courseCredit,
                            attempt: 1,
                            year: new Date().getFullYear().toString()
                        });

                        const points = gradeMap[grade] || 0;
                        totalPoints += points * courseCredit;
                        totalCredits += courseCredit;
                    }
                }

                const calculatedGPA = totalCredits > 0 ? Number((totalPoints / totalCredits).toFixed(2)) : 0;

                if (subjects.length > 0) {
                    resultsToUpsert.push({
                        updateOne: {
                            filter: { studentId: studentId, semester: semester },
                            update: {
                                $set: {
                                    subjects: subjects,
                                    gpa: calculatedGPA
                                }
                            },
                            upsert: true
                        }
                    });
                }
            }
        }

        if (studentsToUpsert.length > 0) {
            await Student.bulkWrite(studentsToUpsert);
            console.log(`Upserted ${studentsToUpsert.length} student records.`);
        }

        if (resultsToUpsert.length > 0) {
            await Result.bulkWrite(resultsToUpsert);
            console.log(`Upserted ${resultsToUpsert.length} result records.`);
        }

        // Cleanup file
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        res.json({
            message: "File uploaded and processed successfully",
            batchId,
            recordCount: documents.length
        });
    } catch (error) {
        console.error("Upload error detail:", error);
        res.status(500).json({ 
            message: "Failed to process result file", 
            error: error.message || String(error),
            stack: error.stack
        });
    }
});

// Retrieve uploaded data by batchId
app.get("/api/sheet-data/:batchId", async (req, res) => {
    try {
        const data = await SheetData.find({ batchId: req.params.batchId });
        res.json(data);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/students/:id/change-password', async (req, res) => {
    try {
        const { password, name } = req.body;
        const student = await Student.findOne({ id: req.params.id });
        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        student.password = hashedPassword;
        student.isFirstLogin = false;

        if (name && name.trim().length > 0) {
            student.name = name.trim();
        }

        await student.save();
        res.json({ message: 'Password and conditionally name updated successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

const { calculateStudentStats } = require('./utils/gpaCalculator');

// Retrieve all uploads metadata
app.get("/api/uploads", async (req, res) => {
    try {
        const uploads = await Upload.find().sort({ uploadedAt: -1 });
        res.json(uploads);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Calculate Student Stats (CGPA, SGPA, Arrears)
app.get('/api/student/:id/stats', async (req, res) => {
    try {
        // Fetch all results for the student
        const results = await Result.find({ studentId: req.params.id });

        if (!results || results.length === 0) {
            return res.status(404).json({ message: 'No results found for this student' });
        }

        const stats = calculateStudentStats(results);
        res.json(stats);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

mongoose.connect(dbUri)
    .then(() => {
        console.log('MongoDB connected');
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Server running on port ${PORT}`);
            const interfaces = require('os').networkInterfaces();
            let addresses = [];
            for (let k in interfaces) {
                for (let k2 in interfaces[k]) {
                    let address = interfaces[k][k2];
                    if (address.family === 'IPv4' && !address.internal) {
                        addresses.push(address.address);
                    }
                }
            }
            console.log(`Network access via IPv4: ${addresses.map(a => `http://${a}:${PORT}/api`).join(', ')}`);
        });
    })
    .catch(err => console.log('MongoDB connection error:', err));
