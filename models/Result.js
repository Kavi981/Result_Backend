const mongoose = require('mongoose');

const ResultSchema = new mongoose.Schema({
    studentId: { type: String, required: true },
    semester: { type: Number, required: true },
    gpa: { type: Number, required: true },
    subjects: [{
        code: String,
        name: String,
        marks: Number,
        grade: String,
        credits: Number,
        attempt: Number,
        year: String
    }]
});

module.exports = mongoose.model('Result', ResultSchema);
