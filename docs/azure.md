# Hosting auf Azure

Wie beim Planer: Docker-Container auf **Azure App Service (Linux)**, Image aus einer **Azure Container Registry**, Deploy per GitHub Actions mit **OpenID Connect** (keine Secrets in GitHub), Anmeldung über die App-Service-Authentifizierung („Easy Auth“) mit **Entra ID**.

```
git push main → GitHub Actions: Tests → Image bauen → Container Registry → App Service
```

## Einrichtung

1. **Cloud Shell öffnen:** <https://shell.azure.com>, Bash.
2. **Ressourcen anlegen:** Inhalt von [`scripts/azure-setup.sh`](../scripts/azure-setup.sh) in eine Datei kopieren, `bash azure-setup.sh`. Wiederholbar.
   - Kosten sparen, Plan und Registry des Planers mitbenutzen:
     `PLAN_RG=rg-planer PLAN=plan-planer ACR_RG=rg-planer ACR=planermdrollo bash azure-setup.sh`
3. **GitHub-Variablen setzen:** die ausgegebenen Werte unter Repo → Settings → Secrets and variables → Actions → **Variables**: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_ACR`, `AZURE_WEBAPP_NAME`. Außerdem unter Settings → Environments eine Umgebung `production` anlegen.
4. **Anmeldung einschalten:** [`scripts/azure-auth.sh`](../scripts/azure-auth.sh) genauso ausführen.
5. **Deployen:** Actions → **Build & Deploy** → Run workflow (oder auf `main` pushen).

Einstellungen der Web-App: `WEBSITES_PORT=8080`, `WEBSITES_ENABLE_APP_SERVICE_STORAGE=true` (damit `/home` erhalten bleibt), `DATA_DIR=/home/data` (SQLite und Anhänge), `TZ=Europe/Berlin`, „Always On“, nur HTTPS.

## Anmeldung und Benutzer

- App-Hülle öffentlich, Daten nur über `/api` mit Anmeldung (`REQUIRE_AUTH=true`). Das Backend liest den Benutzer aus `X-MS-CLIENT-PRINCIPAL*`; Azure setzt diese Header selbst und entfernt sie aus fremden Anfragen. **`REQUIRE_AUTH=true` daher nur hinter Easy Auth betreiben.**
- Standardmäßig „Zuweisung erforderlich“: Wer sich anmelden darf, regelt Entra ID → Unternehmensanwendungen → `owntrello-mdrollo` → **Benutzer und Gruppen**. Mit `ASSIGNMENT_REQUIRED=false bash azure-auth.sh` dürfen sich alle im Tenant anmelden – sie sehen trotzdem nur Boards, die für sie freigegeben sind.
- Wer `azure-auth.sh` ausführt, wird Administrator der App (`ADMIN_USERS`). Weitere Administratoren: Objekt-IDs oder E-Mails kommagetrennt in `ADMIN_USERS`.
- Nur die Graph-Berechtigung `User.Read` (Name und E-Mail aus der Anmeldung).
- Client-Secret läuft nach 2 Jahren ab; erneuern: App-Einstellung `MICROSOFT_PROVIDER_AUTHENTICATION_SECRET` löschen und `azure-auth.sh` erneut ausführen.

## Hinweise

- Der Live-Kanal (`/api/boards/:id/events`) läuft im Prozess. Bei mehr als einer Instanz bräuchte es einen gemeinsamen Bus; die App lädt aber spätestens beim Zurückkehren in den Tab neu.
- Anhänge liegen als Dateien unter `DATA_DIR/attachments`, ihre Metadaten in SQLite. Ein Backup muss beides umfassen (`/home/data`).
