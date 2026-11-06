#!/usr/bin/env bash
# Schaltet die App-Service-Anmeldung ("Easy Auth") mit Entra ID für owntrello ein.
# Ausführen in der Azure Cloud Shell nach scripts/azure-setup.sh. Wiederholbar.
#
# Ergebnis:
#   - App-Registrierung "owntrello-mdrollo" im Tenant (nur Konten dieses Tenants)
#   - Standard: "Zuweisung erforderlich" – nur zugewiesene Benutzer/Gruppen dürfen
#     sich anmelden (ASSIGNMENT_REQUIRED=false: alle im Tenant; welche Boards sie
#     sehen, regeln trotzdem die Rechte pro Board)
#   - Der ausführende Benutzer wird zugewiesen und Administrator der App (ADMIN_USERS)
#   - Anmeldung über Entra ID, Sitzung 30 Tage, Token-Speicher an (für /.auth/me)
#   - App-Hülle (HTML/JS/CSS) öffentlich, Daten unter /api nur mit Anmeldung:
#     Das Backend prüft das selbst (REQUIRE_AUTH=true).
#   - Nur die Graph-Berechtigung User.Read (Name und E-Mail des Benutzers)
# Das Client-Secret wird direkt als App-Einstellung gespeichert und nie angezeigt.
set -euo pipefail

RG=${RG:-rg-owntrello}
APP=${APP:-owntrello-mdrollo}
ASSIGNMENT_REQUIRED=${ASSIGNMENT_REQUIRED:-true}
SECRET_SETTING=MICROSOFT_PROVIDER_AUTHENTICATION_SECRET

say() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }

SUB=$(az account show --query id -o tsv)
TENANT=$(az account show --query tenantId -o tsv)
HOST=$(az webapp show -g "$RG" -n "$APP" --query defaultHostName -o tsv)
CALLBACK="https://$HOST/.auth/login/aad/callback"

say "App-Registrierung $APP"
APP_ID=$(az ad app list --display-name "$APP" --query "[0].appId" -o tsv)
if [ -z "$APP_ID" ]; then
  APP_ID=$(az ad app create --display-name "$APP" --sign-in-audience AzureADMyOrg \
    --web-redirect-uris "$CALLBACK" --enable-id-token-issuance true --query appId -o tsv)
else
  az ad app update --id "$APP_ID" --web-redirect-uris "$CALLBACK" --enable-id-token-issuance true
fi
echo "Client-ID: $APP_ID"

say "Microsoft-Graph-Berechtigung User.Read"
GRAPH=00000003-0000-0000-c000-000000000000
sid=$(az ad sp show --id "$GRAPH" --query "oauth2PermissionScopes[?value=='User.Read'].id | [0]" -o tsv)
az ad app permission add --id "$APP_ID" --api "$GRAPH" --api-permissions "$sid=Scope" -o none 2>/dev/null || true

say "Enterprise-App: Zuweisung erforderlich = $ASSIGNMENT_REQUIRED"
SP_ID=$(az ad sp list --filter "appId eq '$APP_ID'" --query "[0].id" -o tsv)
[ -n "$SP_ID" ] || SP_ID=$(az ad sp create --id "$APP_ID" --query id -o tsv)
az ad sp update --id "$SP_ID" --set appRoleAssignmentRequired="$ASSIGNMENT_REQUIRED"

ME=$(az ad signed-in-user show --query id -o tsv)
ASSIGNED=$(az rest --method GET \
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$SP_ID/appRoleAssignedTo" \
  --query "length(value[?principalId=='$ME'])" -o tsv)
if [ "$ASSIGNED" = "0" ]; then
  az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$SP_ID/appRoleAssignedTo" \
    --headers Content-Type=application/json \
    --body "{\"principalId\":\"$ME\",\"resourceId\":\"$SP_ID\",\"appRoleId\":\"00000000-0000-0000-0000-000000000000\"}" -o none
fi
echo "Zugewiesen: $(az ad signed-in-user show --query userPrincipalName -o tsv)"

say "Client-Secret (2 Jahre) direkt in die App-Einstellungen"
if [ -z "$(az webapp config appsettings list -g "$RG" -n "$APP" --query "[?name=='$SECRET_SETTING'].name" -o tsv)" ]; then
  SECRET=$(az ad app credential reset --id "$APP_ID" --display-name easyauth --years 2 --append --query password -o tsv)
  az webapp config appsettings set -g "$RG" -n "$APP" --settings "$SECRET_SETTING=$SECRET" -o none
  unset SECRET
fi

say "Backend schützt /api selbst; ausführender Benutzer ist Administrator"
az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings REQUIRE_AUTH=true ADMIN_USERS="$ME"

say "Anmeldung an der Web-App einschalten"
cat > /tmp/authsettings.json <<JSON
{
  "properties": {
    "platform": { "enabled": true },
    "globalValidation": {
      "requireAuthentication": false,
      "unauthenticatedClientAction": "AllowAnonymous",
      "redirectToProvider": "azureactivedirectory"
    },
    "identityProviders": {
      "azureActiveDirectory": {
        "enabled": true,
        "registration": {
          "openIdIssuer": "https://login.microsoftonline.com/$TENANT/v2.0",
          "clientId": "$APP_ID",
          "clientSecretSettingName": "$SECRET_SETTING"
        },
        "validation": { "allowedAudiences": ["api://$APP_ID", "$APP_ID"] },
        "login": { "loginParameters": ["scope=openid profile email"] }
      }
    },
    "login": {
      "tokenStore": { "enabled": true },
      "preserveUrlFragmentsForLogins": true,
      "cookieExpiration": { "convention": "FixedTime", "timeToExpiration": "30.00:00:00" }
    },
    "httpSettings": { "requireHttps": true }
  }
}
JSON
az rest --method PUT -o none \
  --uri "https://management.azure.com/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.Web/sites/$APP/config/authsettingsV2?api-version=2023-12-01" \
  --body @/tmp/authsettings.json
rm -f /tmp/authsettings.json

say "Administratorzustimmung für User.Read"
sleep 10  # neu angelegte Berechtigungen brauchen einen Moment
if az ad app permission admin-consent --id "$APP_ID"; then
  echo "Zustimmung erteilt."
else
  echo "Zustimmung fehlgeschlagen – dann stimmt jeder Benutzer bei der ersten Anmeldung selbst zu."
fi

say "Fertig"
echo "App-Registrierung: $APP_ID"
echo "Test: https://$HOST"
if [ "$ASSIGNMENT_REQUIRED" = "true" ]; then
  echo "Weitere Personen: Entra ID → Unternehmensanwendungen → $APP → Benutzer und Gruppen → Zuweisung hinzufügen"
fi
