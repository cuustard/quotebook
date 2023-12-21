from flask import Blueprint, render_template
# views.py

# Now you can use mysqlObject in your views.py
views = Blueprint('views', __name__)


@views.route('/')
def home():
    # cur = mysqlObject.connection.cursor()
    # cur.execute("SELECT * FROM users")
    # fetchdata = cur.fetchall()
    # cur.close()
    return render_template("auth/create_account.html")  # data=fetchdata )
