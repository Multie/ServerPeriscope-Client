
Abfrage ob man den neusten stand herunterladen möchte

    Ist Letzter stand vom letzten host?
        Warten auf host
        Trotzdem abrufen

    Stand herunterladen
    Stand entpacken

Abfrage ob gestart werden soll
    Ja
        Starten

Abfrage ob man der host werden möchte
    Ja
        HTTP GET /host + auth
        Connect Websocket
        Start TCP Client

Drücken von Strg + c
    Stoppen des Webstockets

Fragen ob auch der Sever geschlossen werden soll (falls möglich)
    Ja
        Stoppen des Servers

Fragen ob lokaler Stand zum Server hochgeladen werden soll
    Ja
        lokale Dateien Zip
        Zip Datei hochladen mit Auth auf POST /data, Server fügt Name + Time an


