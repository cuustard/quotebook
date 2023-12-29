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

        # Check if account already exists
        # query for username and email to compare to input
        cur.execute(
            "SELECT username, email FROM users WHERE username = %s OR email = %s", (username, email))
        # only store the first result because we only need to check if there is a result not what the result is
        result = cur.fetchone()
        if result:
            if result[0] == username:
                flash("Account with that username already exists.", category='error')
            if result[1] == email:
                flash("Account with that email already exists.", category='error')
            return redirect(url_for('create_account'))
        # otherwise create account
        else:
            cur.execute(
                "INSERT INTO users(username, email, password) VALUES(%s, %s, %s)", (username, email, password))
            mysqlObject.connection.commit()
        cur.close()
        flash("Account created successfully!", category='success')
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
            flash("Account with that username does not exist.", category='error')
            return redirect(url_for('login'))
        queriedPassword = result[0]
        if password == queriedPassword:
            session['loggedin'] = True
            session['username'] = username
            flash("Logged in successfully!", category='success')
            return redirect(url_for('dashboard'))
        else:
            return "wrong password"
    return render_template("auth/login.html")

# For the dashboard


@app.route('/dashboard', methods=['GET', 'POST'])
@login_required
def dashboard():
    cur = mysqlObject.connection.cursor()
    username = session['username']
    cur.execute("SELECT user_id FROM users WHERE username = %s", [username])
    user_id = cur.fetchone()[0]
    if request.method == 'POST':
        if request.form.get('newQuote') == 'newQuote':
            quoteDetails = request.form
            quote = quoteDetails['quote'].capitalize()
            quotee = quoteDetails['quotee'].title()
            date = quoteDetails['date']
            time = quoteDetails['time']
            if user_id is None:
                return "No data fetched. Something went wrong."
            cur.execute(
                "INSERT INTO quotes(quote, quotee, date, time, user_id) VALUES(%s, %s, %s, %s, %s)", (quote, quotee, date, time, user_id))
            mysqlObject.connection.commit()
            flash("Quote added successfully!", category='success')
            return redirect(url_for('dashboard'))
        elif request.form.get('dateDESC') == 'dateDESC':
            if user_id is None:
                return "No data fetched. Something went wrong."
            cur.execute(
                "SELECT quote, quotee, date, time FROM quotes WHERE user_id = %s ORDER BY date ASC", [user_id])
            result = cur.fetchall()
            return render_template("dashboard/dashboard.html", result=result)
        elif request.form.get('dateASC') == 'dateASC':
            if user_id is None:
                return "No data fetched. Something went wrong."
            cur.execute(
                "SELECT quote, quotee, date, time FROM quotes WHERE user_id = %s ORDER BY date DESC", [user_id])
            result = cur.fetchall()
            return render_template("dashboard/dashboard.html", result=result)
        elif request.form.get('searchButton') == 'searchButton':
            searchDetails = request.form
            search = searchDetails['search']
            if user_id is None:
                return "No data fetched. Something went wrong."
            cur.execute(
                "SELECT quote, quotee, date, time FROM quotes WHERE user_id = %s AND quote LIKE %s", [user_id, "%" + search + "%"])
            result = cur.fetchall()
            return render_template("dashboard/dashboard.html", result=result)

    if user_id is None:
        return "No data fetched. Something went wrong."
    cur.execute(
        "SELECT quote, quotee, date, time FROM quotes WHERE user_id = %s", [user_id])
    result = cur.fetchall()
    cur.close()
    return render_template("dashboard/dashboard.html", result=result)

# For the user settings


@app.route('/user_settings', methods=['GET', 'POST'])
@login_required
def user_settings():
    username = session['username']
    if request.method == 'POST':
        if "deleteAccount" in request.form:
            cur = mysqlObject.connection.cursor()
            cur.execute(
                "SELECT user_id, password FROM users WHERE username = %s", [username])
            result = cur.fetchone()
            if result[1] == request.form['password']:
                cur.execute("DELETE FROM quotes WHERE user_id = %s",
                            [result[0]])
                cur.execute(
                    "DELETE FROM users WHERE username = %s", [session['username']])
                mysqlObject.connection.commit()
                cur.close()
                session.clear()
                flash("Account deleted successfully!", category='success')
                return redirect(url_for('create_account'))
            else:
                return "<p>Wrong password. Account not deleted.</p>"
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
    flash("Logged out successfully!", category='success')
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
