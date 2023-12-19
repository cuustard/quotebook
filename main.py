from flask import Flask, render_template, request, redirect, url_for
from flask_mysqldb import MySQL

from website import create_app

from flask import Flask, render_template, request, redirect, url_for
from flask_mysqldb import MySQL

import hashlib

app = Flask(__name__)

# Configure MySQL connection
app.config['MYSQL_HOST'] = 'localhost'
app.config['MYSQL_USER'] = 'your_username'
app.config['MYSQL_PASSWORD'] = 'asyouwish'
app.config['MYSQL_DATABASE'] = 'quotebook_database'

mysql = MySQL(app)

@app.route('/')
def home():
    return render_template('home.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        # Hash the password before storing
        # password = # Use a secure hashing algorithm like bcrypt
        
        # Insert user into database
        cursor = mysql.connection.cursor()
        cursor.execute("INSERT INTO users (username, password) VALUES (%s, %s)", (username, password))
        mysql.connection.commit()
        cursor.close()
        
        return redirect(url_for('login'))
    return render_template('sign_up.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        
        # Fetch user from database
        cursor = mysql.connection.cursor()
        cursor.execute("SELECT * FROM users WHERE username=%s", (username,))
        user = cursor.fetchone()
        cursor.close()
        
        if user and verify_password(password, user['password']):
            # User found and password correct - log them in (implement your session management here)
            return redirect(url_for('profile'))
        else:
            return "Invalid username or password"
    return render_template('login.html')

@app.route('/logout')
def logout():
    # Implement your session management logout logic here
    return redirect(url_for('home'))

if __name__ == '__main__':
    app.run(debug=True)
