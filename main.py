from flask import Flask, Blueprint, render_template, request, redirect, url_for, flash, session
from flask_mysqldb import MySQL
from website import create_app
from functools import wraps
from datetime import datetime
# instantiate the app AND configure session secret key
app = create_app()
app.secret_key = 'stinky winky baka'

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
        # get the form data
        form = request.form
        # get username input from the form
        username = form['username']
        # get the user_id for the username
        user_id = get_user_id(username)
        password = form['password']
        result = execute_sql_command(
            "SELECT password FROM users WHERE user_id = %s", [user_id])
        # if the result is empty, then the username does not exist so error
        if len(result) < 1:
            flash("Account with that username does not exist.", category='error')
            return redirect(url_for('login'))
        # compare the password input to the password in the database
        elif result[0][0] == password:
            session['loggedin'] = True
            session['username'] = username
            flash("Logged in successfully!", category='success')
            return redirect(url_for('dashboard'))
        else:
            flash("Incorrect password.", category='error')
            return redirect(url_for('login'))
    return render_template("auth/login.html")


def execute_sql_command(query, param):
    cur = mysqlObject.connection.cursor()
    cur.execute(query, param)
    return cur.fetchall()


def get_user_id(username):
    result = execute_sql_command(
        "SELECT user_id FROM users WHERE username = %s", [username])
    # return the first element of the first list in the tuple. THis needs to be done as the query function returns more than 1 row. If there is no result, return None
    return result[0][0] if result else None


def render_dashboard(result, all_quotees):
    return render_template("dashboard/dashboard.html", result=result, all_quotees=all_quotees)

# dashobard route


@app.route('/dashboard', methods=['GET', 'POST'])
@login_required
def dashboard():
    cur = mysqlObject.connection.cursor()
    username = session['username']
    user_id = get_user_id(username)
    if user_id == None:
        return "No data fetched. Something went wrong."
    all_quotees = execute_sql_command(
        "SELECT DISTINCT quotee FROM quotes WHERE user_id = %s", [user_id])

    if request.method == 'POST':
        form = request.form
        if form.get('newQuote'):
            quote = form['quote'].capitalize()
            quotee = form['quotee'].title()
            date = form['date']
            time = form['time']
            execute_sql_command(
                "INSERT INTO quotes(quote, quotee, date, time, user_id) VALUES(%s, %s, %s, %s, %s)", (quote, quotee, date, time, user_id))
            mysqlObject.connection.commit()
            flash("Quote added successfully!", category='success')
            return redirect(url_for('dashboard'))
        # inefficient because it requires the database each time the user clicks to sort their quotebook. I should store the current state of the quotebook in their session and then sort that instead
        elif form.get('dateASC'):
            result = execute_sql_command(
                "SELECT quote_id, quote, quotee, DATE_FORMAT(date, '%%D %%b %%Y'), time FROM quotes WHERE user_id = %s ORDER BY date ASC, time ASC", [user_id])
            return render_dashboard(result, all_quotees)
        elif form.get('searchButton'):
            # filters by the inputted search term
            searchTerm = form['search']
            result = execute_sql_command("SELECT quote_id, quote, quotee, DATE_FORMAT(date, '%%D %%b %%Y'), time FROM quotes WHERE user_id = %s AND quote LIKE %s", [
                                         user_id, "%" + searchTerm + "%"])
            return render_dashboard(result, all_quotees)
        elif form.get('quoteeButton'):
            # Get selected quotees from form data
            selected_quotees = form.getlist('quoteeSelection')

            # Create a string of placeholders for the SQL command
            placeholders = ', '.join(['%s'] * len(selected_quotees))

            # Add user_id to the list of parameters
            params = selected_quotees + [user_id]

            # Modify SQL command to filter quotes by selected quotees
            result = execute_sql_command(
                f"SELECT quote_id, quote, quotee, DATE_FORMAT(date, '%%D %%b %%Y'), time FROM quotes WHERE quotee IN ({placeholders}) AND user_id = %s", params)

            return render_dashboard(result, all_quotees)
        elif form.get('editQuote'):
            quote_id = form['quote_id']
            return render_template("dashboard/edit_quote.html", quote_id=quote_id)
    result = execute_sql_command(
        "SELECT quote_id, quote, quotee, DATE_FORMAT(date, '%%D %%b %%Y'), time FROM quotes WHERE user_id = %s ORDER BY date DESC, time DESC", [user_id])
    return render_template("dashboard/dashboard.html", result=result, all_quotees=all_quotees)


@app.route('/edit_quote', methods=['GET', 'POST'])
@login_required
def edit_quote():
    form = request.form
    if request.method == 'POST':
        quote_id = form['quote_id']
        if form.get('editQuote'):
            result = execute_sql_command(
                "SELECT quote_id, quote, quotee, DATE_FORMAT(date, '%%Y-%%m-%%d'), time FROM quotes WHERE quote_id = %s", [quote_id])
            result = result[0]
            return render_template("dashboard/edit_quote.html", result=result)
        elif form.get('updateQuote'):
            quote = form['quote'].capitalize()
            quotee = form['quotee'].title()
            date = form['date']
            time = form['time']
            cur = mysqlObject.connection.cursor()
            cur.execute("UPDATE quotes SET quote = %s, quotee = %s, date = %s, time = %s WHERE quote_id = %s", [
                quote, quotee, date, time, quote_id])
            mysqlObject.connection.commit()
            cur.close()
            flash("Quote updated successfully!", category='success')
            return redirect(url_for('dashboard'))
        elif form.get('deleteQuote'):
            cur = mysqlObject.connection.cursor()
            cur.execute("DELETE FROM quotes WHERE quote_id = %s", [quote_id])
            mysqlObject.connection.commit()
            cur.close()
            flash("Quote deleted successfully!", category='success')
            return redirect(url_for('dashboard'))
    flash("You attempted to visit the Edit Quote Page without choosing a quote to edit! Click 'Update' to edit a quote.", category='error')
    return redirect(url_for('dashboard'))


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
