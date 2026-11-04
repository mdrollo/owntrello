#!/usr/bin/env bash
# Richtet die Azure-Umgebung für owntrello ein.
# Ausführen in der Azure Cloud Shell (Bash) – dort ist man bereits angemeldet.
# Das Skript ist wiederholbar: Was schon existiert, wird übersprungen.
#
# Ergebnis:
#   - Ressourcengruppe, App-Service-Plan (Linux B1), Web-App
#   - Azure Container Registry (Basic) für das Docker-Image
#   - Managed Identity für GitHub Actions (Anmeldung per OIDC, keine Secrets)
# Am Ende gibt das Skript die Werte aus, die als GitHub-Variablen gebraucht werden.
#
# Kosten sparen: Plan und Registry des Planers mitbenutzen (ein B1-Plan trägt
# mehrere kleine Apps), z. B.:
#   PLAN_RG=rg-planer PLAN=plan-planer ACR_RG=rg-planer ACR=planermdrollo bash azure-setup.sh
set -euo pipefail

RG=${RG:-rg-owntrello}
APP=${APP:-owntrello-mdrollo}
PLAN=${PLAN:-plan-owntrello}
PLAN_RG=${PLAN_RG:-$RG}
ACR=${ACR:-owntrellomdrollo}
ACR_RG=${ACR_RG:-$RG}
ID_NAME=${ID_NAME:-id-owntrello-github}
# Neue GitHub-Repos schicken im OIDC-Token die Kennung mit IDs (owner@id/repo@id).
# Steht sonst in der Fehlermeldung AADSTS700213 bei azure/login.
GH_SUBJECT=${GH_SUBJECT:-repo:mdrollo@18610722/owntrello@1446175216}
REGIONS=${REGIONS:-"swedencentral germanywestcentral northeurope francecentral"}

say() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }

SUB=$(az account show --query id -o tsv)
TENANT=$(az account show --query tenantId -o tsv)
say "Abonnement: $(az account show --query name -o tsv)"

say "Ressourcen-Provider registrieren"
for ns in Microsoft.Web Microsoft.ContainerRegistry Microsoft.ManagedIdentity; do
  az provider register --namespace "$ns" --wait -o none
done

say "Ressourcengruppe $RG"
az group show -n "$RG" -o none 2>/dev/null || az group create -n "$RG" -l swedencentral -o none

say "App-Service-Plan $PLAN (Linux B1) in $PLAN_RG"
LOC=$(az appservice plan show -g "$PLAN_RG" -n "$PLAN" --query location -o tsv 2>/dev/null || true)
if [ -z "$LOC" ]; then
  for r in $REGIONS; do
    echo "Versuche Region $r ..."
    if az appservice plan create -g "$PLAN_RG" -n "$PLAN" --is-linux --sku B1 -l "$r" -o none; then
      LOC=$r; break
    fi
  done
fi
[ -n "$LOC" ] || { echo "Keine Region hat den Plan angenommen."; exit 1; }
PLAN_ID=$(az appservice plan show -g "$PLAN_RG" -n "$PLAN" --query id -o tsv)
echo "Region: $LOC"

say "Container Registry $ACR in $ACR_RG"
if ! az acr show -g "$ACR_RG" -n "$ACR" -o none 2>/dev/null; then
  if [ "$(az acr check-name -n "$ACR" --query nameAvailable -o tsv)" != "true" ]; then
    ACR="${ACR}$RANDOM"; echo "Name vergeben, nehme $ACR"
  fi
  az acr create -g "$ACR_RG" -n "$ACR" --sku Basic -l "$LOC" --admin-enabled false -o none
fi
ACR_ID=$(az acr show -g "$ACR_RG" -n "$ACR" --query id -o tsv)
ACR_SERVER=$(az acr show -g "$ACR_RG" -n "$ACR" --query loginServer -o tsv)

say "Web-App $APP"
if ! az webapp show -g "$RG" -n "$APP" -o none 2>/dev/null; then
  # Platzhalter-Image, bis der erste Deploy aus GitHub das echte Image setzt
  az webapp create -g "$RG" -p "$PLAN_ID" -n "$APP" \
    --container-image-name mcr.microsoft.com/appsvc/staticsite:latest -o none
fi
APP_PRINCIPAL=$(az webapp identity assign -g "$RG" -n "$APP" --query principalId -o tsv)

say "Web-App darf Images aus der Registry ziehen (ohne Passwort)"
az role assignment create --assignee-object-id "$APP_PRINCIPAL" --assignee-principal-type ServicePrincipal \
  --role AcrPull --scope "$ACR_ID" -o none 2>/dev/null || true
az webapp config set -g "$RG" -n "$APP" --always-on true \
  --generic-configurations '{"acrUseManagedIdentityCreds": true}' -o none
az webapp update -g "$RG" -n "$APP" --https-only true -o none
az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings \
  WEBSITES_PORT=8080 WEBSITES_ENABLE_APP_SERVICE_STORAGE=true DATA_DIR=/home/data TZ=Europe/Berlin
az webapp log config -g "$RG" -n "$APP" --docker-container-logging filesystem -o none

say "Identität $ID_NAME für GitHub Actions (OIDC)"
az identity show -g "$RG" -n "$ID_NAME" -o none 2>/dev/null || az identity create -g "$RG" -n "$ID_NAME" -l "$LOC" -o none
ID_CLIENT=$(az identity show -g "$RG" -n "$ID_NAME" --query clientId -o tsv)
ID_PRINCIPAL=$(az identity show -g "$RG" -n "$ID_NAME" --query principalId -o tsv)

for fc in "github-main:${GH_SUBJECT}:ref:refs/heads/main" "github-production:${GH_SUBJECT}:environment:production"; do
  name=${fc%%:*}; subject=${fc#*:}
  az identity federated-credential show -g "$RG" --identity-name "$ID_NAME" -n "$name" -o none 2>/dev/null || \
    az identity federated-credential create -g "$RG" --identity-name "$ID_NAME" -n "$name" \
      --issuer https://token.actions.githubusercontent.com --subject "$subject" \
      --audiences api://AzureADTokenExchange -o none
done

# Rollen: Images in die Registry schieben, Web-App aktualisieren
az role assignment create --assignee-object-id "$ID_PRINCIPAL" --assignee-principal-type ServicePrincipal \
  --role AcrPush --scope "$ACR_ID" -o none 2>/dev/null || true
az role assignment create --assignee-object-id "$ID_PRINCIPAL" --assignee-principal-type ServicePrincipal \
  --role "Website Contributor" --scope "$(az group show -n "$RG" --query id -o tsv)" -o none 2>/dev/null || true

say "Fertig. Diese Werte als GitHub-Variablen eintragen (keine Secrets):"
cat <<OUT
AZURE_CLIENT_ID=$ID_CLIENT
AZURE_TENANT_ID=$TENANT
AZURE_SUBSCRIPTION_ID=$SUB
AZURE_ACR=$ACR_SERVER
AZURE_WEBAPP_NAME=$APP
URL=https://$(az webapp show -g "$RG" -n "$APP" --query defaultHostName -o tsv)
OUT
echo "Danach: scripts/azure-auth.sh für die Anmeldung mit Entra ID."
