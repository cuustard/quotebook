from flask import Flask, render_template, request, redirect, url_for
from flask_mysqldb import MySQL
from website import create_app
from flask import Blueprint, render_template

auth = Blueprint('auth', __name__)


@auth.route('/create_account', methods=['GET', 'POST'])
def sign_up():
    return render_template('auth/create_account.html')
