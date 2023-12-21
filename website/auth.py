from flask import Flask, render_template, request, redirect, url_for
from flask_mysqldb import MySQL
from website import create_app
from flask import Blueprint, render_template

auth = Blueprint('auth', __name__)


@auth.route('/create_account', methods=['GET', 'POST'])
def sign_up():
    if request.method == 'POST':
        email = request.form.get('email')
        username = request.form.get('username')
        password = request.form.get('password')
    return render_template('auth/create_account.html')


@auth.route('/login', methods=['GET', 'POST'])
def login():
    return render_template("auth/login.html")


@auth.route('/logout')
def logout():
    return "<p>logged out</p>"
