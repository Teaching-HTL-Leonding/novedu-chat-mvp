# Temporary redirect for the apex domain novedu.at: every request is answered
# with a 302 to the same path on https://app.novedu.at. It runs on the old App
# Service, which keeps the novedu.at binding and its certificate
# (docs/azure-access.md). Built and pushed by hand:
#
#   docker build --platform linux/amd64 -t rstropek/novedu-redirect:1 deploy/novedu-at-redirect
#   docker push rstropek/novedu-redirect:1
FROM nginx:1.30.5-alpine-slim@sha256:32463212baf0e7d91aded2e9b843a4f2b9e017804b8c9d5bae7b51dcef64389c
COPY default.conf /etc/nginx/conf.d/default.conf
