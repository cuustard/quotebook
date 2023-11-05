function create_account() {
	const username = document.getElementById("username").value;
	const email = document.getElementById("email").value;
	const password = document.getElementById("password").value;

	if (
		validate_email(email) &&
		validate_password(password) &&
		validate_username(username)
	) {
		alert("All inputs are VALID");
		return true;
	} else {
		alert("Username or password or username INVALID");
		return false;
	}
}

function log_in() {
	const email = document.getElementById("email").value;
	const password = document.getElementById("password").value;

	if (validate_email(email) && validate_password(password)) {
		alert("Both are VALID");
		return true;
	} else {
		alert("Email or password INVALID");
		return false;
	}
}

function validate_email(email) {
	const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
	return emailPattern.test(email);
}

function validate_password(password) {
	return password.length > 8 && password.length < 16;
}

function validate_username(username) {
	return username.length > 3 && username.length < 16;
}

function add_quote() {
	const quote = document.getElementById();
}
