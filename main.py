from flask import Blueprint, render_template, request
from flask import Flask
from flask_mysqldb import MySQL
from website import create_app

# instantiate the app
app = create_app()

# Configure MySQL connection
app.config['MYSQL_HOST'] = 'localhost'
app.config['MYSQL_USER'] = 'root'
app.config['MYSQL_PASSWORD'] = 'asyouwish'
app.config['MYSQL_DB'] = 'quotebook_database'

# Initialize a MySQL object
mysqlObject = MySQL(app)

# views.py
views = Blueprint('views', __name__)


@app.route('/', methods=['GET', 'POST'])
def home():
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
        return 'success'
    return render_template("auth/create_account.html")


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


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form['email']
        password = request.form['password']
        cur = mysqlObject.connection.cursor()
        cur.execute(
            "SELECT password FROM users WHERE email = %s", [email])
        result = cur.fetchone()
        cur.close()
        if result is None:
            flash("No user found with this username. Please create an account.", "info")
        queriedPassword = result[0]
        if password == queriedPassword:
            return render_template("login.html")
        else:
            flash("Login unsuccessful.")
    return render_template("auth/login.html")


if __name__ == '__main__':
    app.run(debug=True)
