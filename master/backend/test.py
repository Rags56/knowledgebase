


import psycopg2
postgres_ip = "http://localhost:5432"
print(postgres_ip.split("//")[1].split(":")[0])
print(postgres_ip.split(":")[-1])
conn = psycopg2.connect(
    host=postgres_ip.split("//")[1].split(":")[0], #take only the first part of the ip - http
    port=int(postgres_ip.split(":")[-1]), #take only the second part of the ip
    user="root",
    password="blockexe123",
    database="knowledge_base"
)
#check what tables exist
cursor = conn.cursor()
cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
tables = cursor.fetchall()
print(tables)
conn.close()