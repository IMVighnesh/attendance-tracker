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
} from "https://cdn.jsdelivr.net/npm/date-fns@2.29.3/esm/index.js";

// --- PRE-DEFINED VARIABLES (DO NOT MODIFY) ---
// These variables are placeholders that will be replaced by the environment when you deploy.
// IMPORTANT: Paste your actual Firebase config object here!
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
// This is the core setup for connecting to your Firebase backend.
let app, auth, db;
try {
	app = initializeApp(firebaseConfig);
	auth = getAuth(app);
	db = getFirestore(app);
	// This makes sure the user stays logged in even after closing the browser tab.
	setPersistence(auth, browserLocalPersistence);
} catch (error) {
	console.error("Firebase initialization failed:", error);
	// You might want to show an error message to the user here.
}

// --- GLOBAL STATE ---
// We'll store the current user's data and app state here.
let currentUser = null;
let semesterData = null;
let attendanceData = {};
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
// Caching references to DOM elements for performance.
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const userPhoto = document.getElementById("user-photo");
const setupForm = document.getElementById("setup-form");
const editSemesterBtn = document.getElementById("edit-semester-btn");
const markDayLeaveBtn = document.getElementById("mark-day-leave-btn");

// --- UI VIEW MANAGEMENT ---
// A helper function to switch between different screens of the app.
const views = document.querySelectorAll(".view");
function showView(viewId) {
	views.forEach((view) => view.classList.remove("active"));
	document.getElementById(viewId).classList.add("active");
}

// --- AUTHENTICATION LOGIC ---
// This handles user login, logout, and checks the authentication state.
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
		// User is signed in.
		currentUser = user;
		userInfo.classList.remove("hidden");
		userInfo.classList.add("flex");
		userPhoto.src = user.photoURL;
		initializeUserData();
	} else {
		// User is signed out.
		currentUser = null;
		semesterData = null;
		attendanceData = {};
		userInfo.classList.add("hidden");
		showView("login-view");
	}
});

// --- DATA INITIALIZATION ---
// This function is called after a user logs in. It sets up database references and listeners.
function initializeUserData() {
	showView("loader-view");
	const userId = currentUser.uid;

	// Paths for our data in Firestore. Storing user-specific data under their UID is a standard security practice.
	const userDocPath = `artifacts/${appId}/users/${userId}`;
	semesterDocRef = doc(db, userDocPath, "semester");
	attendanceDocRef = doc(db, userDocPath, "attendance");

	// Set up real-time listeners. These automatically update the app when data changes in the database.
	unsubscribeSemester = onSnapshot(
		semesterDocRef,
		(doc) => {
			if (doc.exists()) {
				semesterData = doc.data();
				// Once we have semester data, we listen for attendance.
				if (!unsubscribeAttendance) {
					listenForAttendance();
				}
				renderDashboard();
				showView("dashboard-view");
			} else {
				// If no semester is set up, show the setup screen.
				renderSetupForm();
				showView("setup-view");
			}
		},
		(error) => console.error("Error listening to semester:", error)
	);
}

function listenForAttendance() {
	unsubscribeAttendance = onSnapshot(
		attendanceDocRef,
		(doc) => {
			attendanceData = doc.exists() ? doc.data() : {};
			if (semesterData) {
				renderDashboard(); // Re-render dashboard with new attendance data
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

	const schedule = {};
	daysOfWeek.slice(1, 6).forEach((day) => {
		// Monday to Friday
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
	};

	try {
		await setDoc(semesterDocRef, newSemesterData);
		// Also initialize the attendance document
		if (!attendanceData || Object.keys(attendanceData).length === 0) {
			await setDoc(attendanceDocRef, {});
		}
		// The onSnapshot listener will automatically handle the UI update.
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
// These functions take data and build the HTML to display it.
function renderSetupForm(data = {}) {
	document.getElementById("start-date").value = data.startDate || "";
	document.getElementById("end-date").value = data.endDate || "";
	const subjects = data.subjects || [];
	document.getElementById("subjects").value = subjects.join(", ");

	const scheduleContainer = document.getElementById("schedule-container");
	scheduleContainer.innerHTML = ""; // Clear previous content

	const subjectsInput = document.getElementById("subjects");

	const renderSchedule = () => {
		const currentSubjects = subjectsInput.value
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		scheduleContainer.innerHTML = "";
		if (currentSubjects.length > 0) {
			daysOfWeek.slice(1, 6).forEach((day) => {
				// Monday to Friday
				let dayHtml = `<div class="p-3 bg-gray-50 rounded-lg">
                    <p class="font-semibold mb-2">${day}</p>
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">`;
				currentSubjects.forEach((subject) => {
					const value = data.schedule?.[day]?.[subject] || 0;
					dayHtml += `
                        <div>
                            <label for="schedule-${day}-${subject}" class="block text-sm text-gray-600">${subject}</label>
                            <input type="number" id="schedule-${day}-${subject}" value="${value}" min="0" class="mt-1 w-full rounded-md border-gray-300 shadow-sm text-sm">
                        </div>`;
				});
				dayHtml += "</div></div>";
				scheduleContainer.innerHTML += dayHtml;
			});
		}
	};

	subjectsInput.addEventListener("input", renderSchedule);
	renderSchedule(); // Initial render
}

function renderDashboard() {
	if (!semesterData) return;

	document.getElementById("semester-name").textContent = semesterData.name;
	renderTodayLectures();
	calculateAndDisplayStats();
}

function renderTodayLectures() {
	const today = new Date();
	const todayStr = format(today, "yyyy-MM-dd");
	document.getElementById("today-date").textContent = format(
		today,
		"do MMM yyyy"
	);

	const dayOfWeek = getDay(today);
	if (dayOfWeek === 0 || dayOfWeek === 6) {
		// Sunday or Saturday
		document.getElementById("today-lectures-container").innerHTML =
			'<p class="text-gray-500">It\'s the weekend! No lectures today.</p>';
		markDayLeaveBtn.disabled = true;
		return;
	}
	markDayLeaveBtn.disabled = false;

	const dayName = daysOfWeek[dayOfWeek];
	const scheduleForToday = semesterData.schedule[dayName];
	const todayLecturesContainer = document.getElementById(
		"today-lectures-container"
	);
	todayLecturesContainer.innerHTML = "";

	let lectureCount = 0;
	semesterData.subjects.forEach((subject) => {
		const numLectures = scheduleForToday?.[subject] || 0;
		for (let i = 1; i <= numLectures; i++) {
			lectureCount++;
			const lectureId = `${subject}-${i}`;
			const isAttended =
				attendanceData[todayStr]?.[lectureId] === "present";
			const lectureHtml = `
                <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span class="font-medium">${subject} (Lecture ${i})</span>
                    <label class="inline-flex items-center cursor-pointer">
                        <input type="checkbox" class="h-6 w-6 rounded text-blue-500 border-gray-300 focus:ring-blue-500 attendance-checkbox" 
                            data-date="${todayStr}" data-lecture-id="${lectureId}" ${
				isAttended ? "checked" : ""
			}>
                        <span class="ml-3 text-sm font-medium ${
							isAttended ? "text-green-600" : "text-red-600"
						}">${isAttended ? "Present" : "Absent"}</span>
                    </label>
                </div>
            `;
			todayLecturesContainer.insertAdjacentHTML("beforeend", lectureHtml);
		}
	});

	if (lectureCount === 0) {
		todayLecturesContainer.innerHTML =
			'<p class="text-gray-500">No lectures scheduled for today.</p>';
		markDayLeaveBtn.disabled = true;
	}

	// Add event listeners to new checkboxes
	document.querySelectorAll(".attendance-checkbox").forEach((checkbox) => {
		checkbox.addEventListener("change", handleAttendanceChange);
	});
}

// --- CORE LOGIC: ATTENDANCE CALCULATION ---
// This is the brain of the app. It calculates all the stats.
function calculateAndDisplayStats() {
	const today = new Date();
	const start = parseISO(semesterData.startDate);
	const end = parseISO(semesterData.endDate);

	if (today < start) {
		// Semester hasn't started
		// TODO: Show a message
		return;
	}

	const allSemesterDays = eachDayOfInterval({ start, end });
	const pastAndTodayDays = allSemesterDays.filter((d) => d <= today);

	const stats = {
		overall: { total: 0, attended: 0, absent: 0 },
		monthly: { total: 0, attended: 0, absent: 0 },
		subjects: {},
	};

	semesterData.subjects.forEach((sub) => {
		stats.subjects[sub] = { total: 0, attended: 0, absent: 0 };
	});

	// Calculate total and attended/absent lectures
	pastAndTodayDays.forEach((day) => {
		const dayOfWeek = getDay(day);
		if (dayOfWeek === 0 || dayOfWeek === 6) return; // Skip weekends

		const dayName = daysOfWeek[dayOfWeek];
		const dayStr = format(day, "yyyy-MM-dd");
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
					// Any lecture not marked 'present' is considered absent for past days
					stats.overall.absent++;
					stats.subjects[subject].absent++;
					if (isCurrentMonth) stats.monthly.absent++;
				}
			}
		});
	});

	// Calculate 'Bunks Left'
	const requiredPercentage = 0.75;

	// 1. Semester Bunks
	const totalSemesterLectures = getTotalLecturesInInterval({ start, end });
	const requiredSemesterLectures = Math.ceil(
		totalSemesterLectures * requiredPercentage
	);
	const maxSemesterBunks = totalSemesterLectures - requiredSemesterLectures;
	const semesterBunksLeft = Math.max(
		0,
		maxSemesterBunks - stats.overall.absent
	);

	// 2. Monthly Bunks
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

	// --- Update UI ---
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

		subjectContainer.innerHTML += `
            <div>
                <div class="flex justify-between items-center mb-1">
                    <span class="font-semibold">${subject}</span>
                    <span class="text-sm font-bold">${subPercent}%</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-2.5">
                    <div class="${colorClass} h-2.5 rounded-full" style="width: ${subPercent}%"></div>
                </div>
                <div class="text-xs text-gray-500 mt-1 flex justify-between">
                    <span>Attended: ${subStats.attended}/${subStats.total}</span>
                    <span class="font-medium">Bunks Left: ${subBunksLeft}</span>
                </div>
            </div>`;
	});
}

function getTotalLecturesInInterval(interval, specificSubject = null) {
	let totalLectures = 0;
	const days = eachDayOfInterval(interval);
	const semStart = parseISO(semesterData.startDate);
	const semEnd = parseISO(semesterData.endDate);

	days.forEach((day) => {
		if (!isWithinInterval(day, { start: semStart, end: semEnd })) return;

		const dayOfWeek = getDay(day);
		if (dayOfWeek === 0 || dayOfWeek === 6) return;

		const dayName = daysOfWeek[dayOfWeek];
		const daySchedule = semesterData.schedule[dayName];

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

	// Firestore uses dot notation for nested fields, which is perfect here.
	const fieldPath = `${date}.${lectureId}`;
	try {
		await updateDoc(attendanceDocRef, { [fieldPath]: status });
		// The onSnapshot listener will re-calculate and re-render everything automatically.
	} catch (error) {
		console.error("Failed to update attendance:", error);
		// Revert checkbox state on error
		checkbox.checked = !checkbox.checked;
	}
}

markDayLeaveBtn.addEventListener("click", () => {
	showModal(
		"Mark Day as Leave?",
		"This will mark all of today's lectures as absent. This action can be undone by manually checking each lecture as present.",
		() => markDayAsLeave()
	);
});

async function markDayAsLeave() {
	const today = new Date();
	const todayStr = format(today, "yyyy-MM-dd");
	const dayOfWeek = getDay(today);
	if (dayOfWeek === 0 || dayOfWeek === 6) return;

	const dayName = daysOfWeek[dayOfWeek];
	const scheduleForToday = semesterData.schedule[dayName];

	const updates = {};
	semesterData.subjects.forEach((subject) => {
		const numLectures = scheduleForToday[subject] || 0;
		for (let i = 1; i <= numLectures; i++) {
			const lectureId = `${subject}-${i}`;
			updates[`${todayStr}.${lectureId}`] = "absent";
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
// This is what enables the offline capabilities.
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
