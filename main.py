from flask import Flask, Blueprint, render_template, request, redirect, url_for, flash, session
from flask_mysqldb import MySQL
from website import create_app
from functools import wraps

# instantiate the app AND configure session secret key
app = create_app()
app.secret_key = 'your secret key'

# Configure MySQL connection
app.config['MYSQL_HOST'] = 'localhost'
app.config['MYSQL_USER'] = 'root'
app.config['MYSQL_PASSWORD'] = 'asyouwish'
app.config['MYSQL_DB'] = 'quotebook_database'

# Initialise a MySQL object
mysqlObject = MySQL(app)

# Decorator for routes that require a user to be logge d in


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # User is not loggedin redirect to login page
        if 'loggedin' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function


# For creating a new account
@app.route('/', methods=['GET', 'POST'])
def create_account():
    if request.method == 'POST':
        # Fetch form data
        userDetails = request.form
        username = userDetails['username']
        email = userDetails['email']
        password = userDetails['password']
        cur = mysqlObject.connection.cursor()
        cur.execute(
            "INSERT INTO users(username, email, password) VALUES(%s, %s, %s)", (username, email, password))
        mysqlObject.connection.commit()
        cur.close()
        return redirect(url_for('login'))
    return render_template("auth/create_account.html")

# For logging in


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        userDetails = request.form
        username = userDetails['username']
        password = userDetails['password']
        cur = mysqlObject.connection.cursor()
        cur.execute(
            "SELECT password FROM users WHERE username = %s", [username])
        result = cur.fetchone()
        cur.close()
        if result is None:
            return "No data fetched. Something went wrong. or there is not account registed with this username."
        queriedPassword = result[0]
        if password == queriedPassword:
            session['loggedin'] = True
            session['username'] = username
            return redirect(url_for('dashboard'))
        else:
            return "wrong password"
    return render_template("auth/login.html")

# For the dashboard


@app.route('/dashboard')
@login_required
def dashboard():
    return render_template("dashboard/dashboard.html")

# For the user settings


@app.route('/user_settings')
@login_required
def settings():
    return render_template("dashboard/settings.html")

# For the quotebook list


@app.route('/quotebook_list')
@login_required
def quotebook_list():
    return render_template("dashboard/quotebook_list.html")

# To logout


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('create_account'))


############ TEMPORARY test routes ############
# For testing database connection
@app.route('/test_db_connection')
def test_db_connection():
    try:
        cur = mysqlObject.connection.cursor()
        cur.execute("SELECT * FROM users")
        result = cur.fetchall()
        cur.close()
        if result is None:
            return "No data fetched. Something went wrong."
        else:
            return str(result)
    except Exception as e:
        return str(e)

# For testing session


@app.route('/test_session')
def test_session():
    return str(session['username'])
############ END TEMPORARY test routes ############


if __name__ == '__main__':
    app.run(debug=True)
