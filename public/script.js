// --- IMPORTS ---
// Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
	getAuth,
	GoogleAuthProvider,
	signInWithPopup,
	signOut,
	onAuthStateChanged,
	setPersistence,
	browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
	getFirestore,
	doc,
	getDoc,
	setDoc,
	onSnapshot,
	updateDoc,
	deleteField,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// date-fns for easy date manipulation
import {
	format,
	parseISO,
	eachDayOfInterval,
	getDay,
	getMonth,
	getYear,
	isWithinInterval,
	startOfMonth,
	endOfMonth,
	addDays,
	subDays,
	isToday,
	isBefore,
	isAfter,
} from "https://cdn.jsdelivr.net/npm/date-fns@2.29.3/esm/index.js";

// --- PRE-DEFINED VARIABLES (DO NOT MODIFY) ---
const firebaseConfig = {
	apiKey: "AIzaSyAODkLttfUkwSSUik7efk83oXjF4KwBf5Q",
	authDomain: "attendance-tracker-basic.firebaseapp.com",
	projectId: "attendance-tracker-basic",
	storageBucket: "attendance-tracker-basic.firebasestorage.app",
	messagingSenderId: "125047065286",
	appId: "1:125047065286:web:2229dff632da9aa97de5c7",
	measurementId: "G-69W05QJW81",
};
const appId =
	typeof __app_id !== "undefined" ? __app_id : "default-attendance-app";

// --- FIREBASE INITIALIZATION ---
let app, auth, db;
try {
	app = initializeApp(firebaseConfig);
	auth = getAuth(app);
	db = getFirestore(app);
	setPersistence(auth, browserLocalPersistence);
} catch (error) {
	console.error("Firebase initialization failed:", error);
}

// --- GLOBAL STATE ---
let currentUser = null;
let semesterData = null;
let attendanceData = {};
let selectedDate = new Date();
let semesterDocRef = null;
let attendanceDocRef = null;
let unsubscribeSemester = null;
let unsubscribeAttendance = null;
const daysOfWeek = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

// --- DOM ELEMENTS ---
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const userPhoto = document.getElementById("user-photo");
const setupForm = document.getElementById("setup-form");
const editSemesterBtn = document.getElementById("edit-semester-btn");
const markDayLeaveBtn = document.getElementById("mark-day-leave-btn");
const holidayBtn = document.getElementById("holiday-btn");
const datePicker = document.getElementById("date-picker");
const prevDayBtn = document.getElementById("prev-day-btn");
const nextDayBtn = document.getElementById("next-day-btn");

// --- UI VIEW MANAGEMENT ---
const views = document.querySelectorAll(".view");
function showView(viewId) {
	views.forEach((view) => view.classList.remove("active"));
	document.getElementById(viewId).classList.add("active");
}

// --- AUTHENTICATION LOGIC ---
const provider = new GoogleAuthProvider();
loginBtn.addEventListener("click", () => {
	signInWithPopup(auth, provider).catch((error) =>
		console.error("Login failed:", error)
	);
});

logoutBtn.addEventListener("click", () => {
	if (unsubscribeSemester) unsubscribeSemester();
	if (unsubscribeAttendance) unsubscribeAttendance();
	signOut(auth).catch((error) => console.error("Logout failed:", error));
});

onAuthStateChanged(auth, (user) => {
	if (user) {
		currentUser = user;
		userInfo.classList.remove("hidden");
		userInfo.classList.add("flex");
		userPhoto.src = user.photoURL;
		initializeUserData();
	} else {
		currentUser = null;
		semesterData = null;
		attendanceData = {};
		selectedDate = new Date();
		userInfo.classList.add("hidden");
		showView("login-view");
	}
});

// --- DATE NAVIGATION & HOLIDAY LOGIC ---
prevDayBtn.addEventListener("click", () => {
	selectedDate = subDays(selectedDate, 1);
	renderDashboard();
});

nextDayBtn.addEventListener("click", () => {
	selectedDate = addDays(selectedDate, 1);
	renderDashboard();
});

datePicker.addEventListener("change", (e) => {
	const [year, month, day] = e.target.value.split("-").map(Number);
	selectedDate = new Date(year, month - 1, day);
	renderDashboard();
});

holidayBtn.addEventListener("click", async () => {
	const dateStr = format(selectedDate, "yyyy-MM-dd");
	const isHoliday = attendanceData.holidays?.[dateStr] === true;
	const fieldPath = `holidays.${dateStr}`;

	try {
		if (isHoliday) {
			// Unmark as holiday by deleting the field
			await updateDoc(attendanceDocRef, { [fieldPath]: deleteField() });
		} else {
			// Mark as holiday
			await updateDoc(attendanceDocRef, { [fieldPath]: true });
		}
	} catch (error) {
		console.error("Failed to update holiday status:", error);
	}
});

// --- DATA INITIALIZATION ---
function initializeUserData() {
	showView("loader-view");
	const userId = currentUser.uid;
	const userDocPath = `artifacts/${appId}/users/${userId}`;

	semesterDocRef = doc(db, userDocPath, "semester", "data");
	attendanceDocRef = doc(db, userDocPath, "attendance", "data");

	unsubscribeSemester = onSnapshot(
		semesterDocRef,
		(doc) => {
			if (doc.exists()) {
				semesterData = doc.data();
				if (!unsubscribeAttendance) {
					listenForAttendance();
				}
				showView("dashboard-view");
				renderDashboard();
			} else {
				showView("setup-view");
				renderSetupForm();
			}
		},
		(error) => {
			console.error("Error listening to semester:", error);
			showView("login-view");
		}
	);
}

function listenForAttendance() {
	unsubscribeAttendance = onSnapshot(
		attendanceDocRef,
		(doc) => {
			attendanceData = doc.exists() ? doc.data() : { holidays: {} };
			if (semesterData) {
				renderDashboard();
			}
		},
		(error) => console.error("Error listening to attendance:", error)
	);
}

// --- SETUP FORM LOGIC ---
setupForm.addEventListener("submit", async (e) => {
	e.preventDefault();
	const startDate = document.getElementById("start-date").value;
	const endDate = document.getElementById("end-date").value;
	const subjects = document
		.getElementById("subjects")
		.value.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	// Get selected weekend days
	const weekendDays = [];
	document
		.querySelectorAll(".weekend-checkbox:checked")
		.forEach((checkbox) => {
			weekendDays.push(parseInt(checkbox.value));
		});

	const schedule = {};
	const workingDays = daysOfWeek.filter((day, i) => !weekendDays.includes(i));
	workingDays.forEach((day) => {
		schedule[day] = {};
		subjects.forEach((subject) => {
			const input = document.getElementById(`schedule-${day}-${subject}`);
			schedule[day][subject] = parseInt(input.value) || 0;
		});
	});

	if (subjects.length === 0 || !startDate || !endDate) {
		alert("Please fill all required fields.");
		return;
	}

	const semesterName = `${format(parseISO(startDate), "MMM yyyy")} - ${format(
		parseISO(endDate),
		"MMM yyyy"
	)}`;

	const newSemesterData = {
		startDate,
		endDate,
		subjects,
		schedule,
		name: semesterName,
		weekendDays,
	};

	try {
		await setDoc(semesterDocRef, newSemesterData);
		if (!attendanceData || Object.keys(attendanceData).length === 0) {
			await setDoc(attendanceDocRef, { holidays: {} });
		}
	} catch (error) {
		console.error("Error saving semester:", error);
		alert("Failed to save semester settings.");
	}
});

editSemesterBtn.addEventListener("click", () => {
	renderSetupForm(semesterData);
	showView("setup-view");
});

// --- RENDERING FUNCTIONS ---
function renderSetupForm(data = {}) {
	document.getElementById("start-date").value = data.startDate || "";
	document.getElementById("end-date").value = data.endDate || "";
	const subjects = data.subjects || [];
	document.getElementById("subjects").value = subjects.join(", ");

	// Render weekend checkboxes
	const weekendContainer = document.getElementById("weekend-container");
	const savedWeekends = data.weekendDays || [0, 6]; // Default Sunday and Saturday
	weekendContainer.innerHTML = "";
	daysOfWeek.forEach((day, index) => {
		const isChecked = savedWeekends.includes(index);
		weekendContainer.innerHTML += `
            <label class="inline-flex items-center">
                <input type="checkbox" class="weekend-checkbox rounded" value="${index}" ${
			isChecked ? "checked" : ""
		}>
                <span class="ml-2 text-sm">${day}</span>
            </label>
        `;
	});

	const scheduleContainer = document.getElementById("schedule-container");
	const subjectsInput = document.getElementById("subjects");

	const renderSchedule = () => {
		const currentSubjects = subjectsInput.value
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		const selectedWeekendDays = [];
		document
			.querySelectorAll(".weekend-checkbox:checked")
			.forEach((checkbox) => {
				selectedWeekendDays.push(parseInt(checkbox.value));
			});

		scheduleContainer.innerHTML = "";
		if (currentSubjects.length > 0) {
			daysOfWeek.forEach((day, index) => {
				if (selectedWeekendDays.includes(index)) return; // Skip weekends
				let dayHtml = `<div class="p-3 bg-gray-50 rounded-lg"><p class="font-semibold mb-2">${day}</p><div class="grid grid-cols-2 sm:grid-cols-3 gap-2">`;
				currentSubjects.forEach((subject) => {
					const value = data.schedule?.[day]?.[subject] || 0;
					dayHtml += `<div><label for="schedule-${day}-${subject}" class="block text-sm text-gray-600">${subject}</label><input type="number" id="schedule-${day}-${subject}" value="${value}" min="0" class="mt-1 w-full rounded-md border-gray-300 shadow-sm text-sm"></div>`;
				});
				dayHtml += "</div></div>";
				scheduleContainer.innerHTML += dayHtml;
			});
		}
	};

	document
		.getElementById("weekend-container")
		.addEventListener("change", renderSchedule);
	subjectsInput.addEventListener("input", renderSchedule);
	renderSchedule();
}

function renderDashboard() {
	if (!semesterData) return;

	const semStartDate = parseISO(semesterData.startDate);
	const today = new Date();
	datePicker.min = semesterData.startDate;
	datePicker.max = format(today, "yyyy-MM-dd");
	datePicker.value = format(selectedDate, "yyyy-MM-dd");

	prevDayBtn.disabled = isBefore(selectedDate, addDays(semStartDate, 1));
	nextDayBtn.disabled = isToday(selectedDate) || isAfter(selectedDate, today);

	document.getElementById("semester-name").textContent = semesterData.name;
	renderLecturesForDate(selectedDate);
	calculateAndDisplayStats();
}

function renderLecturesForDate(dateToRender) {
	const dateStr = format(dateToRender, "yyyy-MM-dd");
	const dayOfWeek = getDay(dateToRender);
	const isFutureDate =
		isAfter(dateToRender, new Date()) && !isToday(dateToRender);

	const weekendDays = semesterData.weekendDays || [0, 6];
	const isWeekend = weekendDays.includes(dayOfWeek);
	const isHoliday = attendanceData.holidays?.[dateStr] === true;

	if (isWeekend || isHoliday) {
		let message = isHoliday
			? `This day is marked as a Holiday.`
			: `It's the weekend! No lectures scheduled.`;
		document.getElementById(
			"lectures-container"
		).innerHTML = `<p class="text-gray-500 text-center p-4">${message}</p>`;
		markDayLeaveBtn.disabled = true;
		holidayBtn.textContent = isHoliday
			? "Unmark Holiday"
			: "Mark as Holiday";
		holidayBtn.disabled = isFutureDate;
		return;
	}

	markDayLeaveBtn.disabled = isFutureDate;
	holidayBtn.textContent = "Mark as Holiday";
	holidayBtn.disabled = isFutureDate;

	const dayName = daysOfWeek[dayOfWeek];
	const scheduleForDay = semesterData.schedule[dayName] || {};
	const lecturesContainer = document.getElementById("lectures-container");
	lecturesContainer.innerHTML = "";

	let lectureCount = 0;
	semesterData.subjects.forEach((subject) => {
		const numLectures = scheduleForDay[subject] || 0;
		for (let i = 1; i <= numLectures; i++) {
			lectureCount++;
			const lectureId = `${subject}-${i}`;
			const isAttended =
				attendanceData[dateStr]?.[lectureId] === "present";
			const lectureHtml = `<div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg"><span class="font-medium">${subject} (Lecture ${i})</span><label class="inline-flex items-center cursor-pointer"><input type="checkbox" class="h-6 w-6 rounded text-blue-500 border-gray-300 focus:ring-blue-500 attendance-checkbox" data-date="${dateStr}" data-lecture-id="${lectureId}" ${
				isAttended ? "checked" : ""
			} ${
				isFutureDate ? "disabled" : ""
			}><span class="ml-3 text-sm font-medium ${
				isAttended ? "text-green-600" : "text-red-600"
			}">${isAttended ? "Present" : "Absent"}</span></label></div>`;
			lecturesContainer.insertAdjacentHTML("beforeend", lectureHtml);
		}
	});

	if (lectureCount === 0) {
		lecturesContainer.innerHTML =
			'<p class="text-gray-500 text-center p-4">No lectures scheduled for this day.</p>';
		markDayLeaveBtn.disabled = true;
	}

	document.querySelectorAll(".attendance-checkbox").forEach((checkbox) => {
		checkbox.addEventListener("change", handleAttendanceChange);
	});
}

// --- CORE LOGIC: ATTENDANCE CALCULATION ---
function calculateAndDisplayStats() {
	const today = new Date();
	const start = parseISO(semesterData.startDate);
	const end = parseISO(semesterData.endDate);
	const weekendDays = semesterData.weekendDays || [0, 6];

	if (isBefore(today, start)) return;

	const allSemesterDays = eachDayOfInterval({ start, end });
	const pastAndTodayDays = allSemesterDays.filter((d) => !isAfter(d, today));

	const stats = {
		overall: { total: 0, attended: 0, absent: 0 },
		monthly: { total: 0, attended: 0, absent: 0 },
		subjects: {},
	};

	semesterData.subjects.forEach((sub) => {
		stats.subjects[sub] = { total: 0, attended: 0, absent: 0 };
	});

	pastAndTodayDays.forEach((day) => {
		const dayOfWeek = getDay(day);
		const dayStr = format(day, "yyyy-MM-dd");
		if (
			weekendDays.includes(dayOfWeek) ||
			attendanceData.holidays?.[dayStr]
		)
			return;

		const dayName = daysOfWeek[dayOfWeek];
		const dayAttendance = attendanceData[dayStr] || {};
		const isCurrentMonth =
			getMonth(day) === getMonth(today) &&
			getYear(day) === getYear(today);

		semesterData.subjects.forEach((subject) => {
			const lecturesToday =
				semesterData.schedule[dayName]?.[subject] || 0;
			for (let i = 1; i <= lecturesToday; i++) {
				const lectureId = `${subject}-${i}`;
				stats.overall.total++;
				stats.subjects[subject].total++;
				if (isCurrentMonth) stats.monthly.total++;

				if (dayAttendance[lectureId] === "present") {
					stats.overall.attended++;
					stats.subjects[subject].attended++;
					if (isCurrentMonth) stats.monthly.attended++;
				} else {
					stats.overall.absent++;
					stats.subjects[subject].absent++;
					if (isCurrentMonth) stats.monthly.absent++;
				}
			}
		});
	});

	const requiredPercentage = 0.75;

	const totalSemesterLectures = getTotalLecturesInInterval({ start, end });
	const requiredSemesterLectures = Math.ceil(
		totalSemesterLectures * requiredPercentage
	);
	const maxSemesterBunks = totalSemesterLectures - requiredSemesterLectures;
	const semesterBunksLeft = Math.max(
		0,
		maxSemesterBunks - stats.overall.absent
	);

	const monthStart = startOfMonth(today);
	const monthEnd = endOfMonth(today);
	const totalMonthlyLectures = getTotalLecturesInInterval({
		start: monthStart,
		end: monthEnd,
	});
	const requiredMonthlyLectures = Math.ceil(
		totalMonthlyLectures * requiredPercentage
	);
	const maxMonthlyBunks = totalMonthlyLectures - requiredMonthlyLectures;
	const monthlyBunksLeft = Math.max(
		0,
		maxMonthlyBunks - stats.monthly.absent
	);

	const overallPercent =
		stats.overall.total > 0
			? ((stats.overall.attended / stats.overall.total) * 100).toFixed(1)
			: "N/A";
	document.getElementById(
		"overall-attendance-percent"
	).textContent = `${overallPercent}%`;
	document.getElementById("semester-bunks-left").textContent =
		semesterBunksLeft;
	document.getElementById("monthly-bunks-left").textContent =
		monthlyBunksLeft;

	const subjectContainer = document.getElementById("subject-stats-container");
	subjectContainer.innerHTML = "";
	semesterData.subjects.forEach((subject) => {
		const subStats = stats.subjects[subject];
		const subPercent =
			subStats.total > 0
				? ((subStats.attended / subStats.total) * 100).toFixed(1)
				: "N/A";
		const totalSubLectures = getTotalLecturesInInterval(
			{ start, end },
			subject
		);
		const requiredSubLectures = Math.ceil(
			totalSubLectures * requiredPercentage
		);
		const maxSubBunks = totalSubLectures - requiredSubLectures;
		const subBunksLeft = Math.max(0, maxSubBunks - subStats.absent);
		const colorClass =
			subPercent >= 75
				? "bg-green-500"
				: subPercent >= 60
				? "bg-yellow-500"
				: "bg-red-500";
		subjectContainer.innerHTML += `<div><div class="flex justify-between items-center mb-1"><span class="font-semibold">${subject}</span><span class="text-sm font-bold">${subPercent}%</span></div><div class="w-full bg-gray-200 rounded-full h-2.5"><div class="${colorClass} h-2.5 rounded-full" style="width: ${subPercent}%"></div></div><div class="text-xs text-gray-500 mt-1 flex justify-between"><span>Attended: ${subStats.attended}/${subStats.total}</span><span class="font-medium">Bunks Left: ${subBunksLeft}</span></div></div>`;
	});
}

function getTotalLecturesInInterval(interval, specificSubject = null) {
	let totalLectures = 0;
	const days = eachDayOfInterval(interval);
	const semStart = parseISO(semesterData.startDate);
	const semEnd = parseISO(semesterData.endDate);
	const weekendDays = semesterData.weekendDays || [0, 6];

	days.forEach((day) => {
		if (!isWithinInterval(day, { start: semStart, end: semEnd })) return;
		const dayOfWeek = getDay(day);
		const dayStr = format(day, "yyyy-MM-dd");
		if (
			weekendDays.includes(dayOfWeek) ||
			attendanceData.holidays?.[dayStr]
		)
			return;

		const dayName = daysOfWeek[dayOfWeek];
		const daySchedule = semesterData.schedule[dayName] || {};
		if (specificSubject) {
			totalLectures += daySchedule[specificSubject] || 0;
		} else {
			semesterData.subjects.forEach((subject) => {
				totalLectures += daySchedule[subject] || 0;
			});
		}
	});
	return totalLectures;
}

// --- EVENT HANDLERS ---
async function handleAttendanceChange(event) {
	const checkbox = event.target;
	const date = checkbox.dataset.date;
	const lectureId = checkbox.dataset.lectureId;
	const status = checkbox.checked ? "present" : "absent";

	const fieldPath = `${date}.${lectureId}`;
	try {
		await updateDoc(attendanceDocRef, { [fieldPath]: status });
	} catch (error) {
		console.error("Failed to update attendance:", error);
		checkbox.checked = !checkbox.checked;
	}
}

markDayLeaveBtn.addEventListener("click", () => {
	showModal(
		`Mark ${format(selectedDate, "do MMM")} as Leave?`,
		"This will mark all lectures for the selected day as absent. This action can be undone by manually checking each lecture as present.",
		() => markDayAsLeave()
	);
});

async function markDayAsLeave() {
	const dateStr = format(selectedDate, "yyyy-MM-dd");
	const dayOfWeek = getDay(selectedDate);
	if ((semesterData.weekendDays || [0, 6]).includes(dayOfWeek)) return;

	const dayName = daysOfWeek[dayOfWeek];
	const scheduleForDay = semesterData.schedule[dayName] || {};

	const updates = {};
	semesterData.subjects.forEach((subject) => {
		const numLectures = scheduleForDay[subject] || 0;
		for (let i = 1; i <= numLectures; i++) {
			const lectureId = `${subject}-${i}`;
			updates[`${dateStr}.${lectureId}`] = "absent";
		}
	});

	if (Object.keys(updates).length > 0) {
		try {
			await updateDoc(attendanceDocRef, updates);
		} catch (error) {
			console.error("Failed to mark day as leave:", error);
		}
	}
}

// --- MODAL LOGIC ---
const modal = document.getElementById("confirmation-modal");
const modalTitle = document.getElementById("modal-title");
const modalMessage = document.getElementById("modal-message");
const modalCancelBtn = document.getElementById("modal-cancel-btn");
const modalConfirmBtn = document.getElementById("modal-confirm-btn");
let confirmCallback = null;

function showModal(title, message, onConfirm) {
	modalTitle.textContent = title;
	modalMessage.textContent = message;
	confirmCallback = onConfirm;
	modal.classList.remove("hidden");
}

function hideModal() {
	modal.classList.add("hidden");
	confirmCallback = null;
}

modalCancelBtn.addEventListener("click", hideModal);
modalConfirmBtn.addEventListener("click", () => {
	if (confirmCallback) {
		confirmCallback();
	}
	hideModal();
});

// --- PWA SERVICE WORKER ---
if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker
			.register("/sw.js")
			.then((registration) => {
				console.log(
					"ServiceWorker registration successful with scope: ",
					registration.scope
				);
			})
			.catch((err) => {
				console.log("ServiceWorker registration failed: ", err);
			});
	});
}
