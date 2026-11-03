
v1 unreliable/unordered -> basically udp
v2 reliavble/ordered -> basically tcp
v3 unreliable eigene reliablity ->
- sequenznummer 
- acks 
- slektiv wiedeholen von wichtigen daten

tc/netem dafuer da um kuenstlich netzwerkprobleme zu simulieren
was kann gemacht werden:
- delay mit varianz
- paketverlust
- pakete umordnen 


Testumgebung
debian 13 oder Fedora 44 kde oder 

Stack
warscheinlich
ts + vite + canvas2d
python

# basic idee
Python script (orchestrator):
- configuriert netzwerk, veth und tc/netem (netem irgenwie vereinfacht controllierbar potentziell?)
- startet server (ueber den peers sich finden)
- das N instancen das die whiteboard clients in verschiedenen chrome instancen startet. (flag ob automatisch oder manuell) 
- Diese werden dann ueber playwright automatisch getestet.
    - jede version (flag?)
    - repetition (flag?)
    (- unterschiedliche netem settings?)
- jeder browser loggt seine events (sende und empfangszeitpunkte, seqnummer, )
- orchestrator sammelt tcpdump und tc -s 

spaeter python script oder notebook evaluieren der daten und plottet dieser mit matplotlib 


flags potentziell in config datei auslegen (yaml?)
potentziell metadaten ueber lauf abspeichern
- Variante, Profil, netem-Befehl, Seed, Chrome-Version, Zeitstempel und Git-Commit


aktualitaet, vollstaendigkeit, kommunikationsaufwand


allgemeines

2/3 implementierung
1/3 ausarbeitung ca 10-15 setien vortrag

alle 2 wochen statusbericht
jeder zeit fragen entweder fr oder per mail

llm 
nicht dagegen aber ausgereifte loesung
sinvoll, prompten, architektur vorgeben, messlatten vorgeben 
managen, validierung.

auch fuer ausarbeitung