const mongoose = require('mongoose');

const CourseSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    title: { type: String },
    credits: { type: Number, required: true },
});

module.exports = mongoose.model('Course', CourseSchema);
