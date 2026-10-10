# Novedu's fake LLM as a container image, for compose.yaml (docs/testing.md,
# "Fake LLM"). Build from the repo root:
#
#   docker build -f fake-llm/Dockerfile -t novedu-fake-llm:local .
#
# aimock is installed at the exact version the root package.json pins, so the
# image and the e2e suite always run the same fake. It has no dependencies of
# its own; --legacy-peer-deps keeps its optional test-runner peers out.
FROM node:24-alpine

WORKDIR /fake-llm

COPY package.json /tmp/novedu-package.json
RUN npm install --no-save --no-audit --no-fund --legacy-peer-deps \
      "@copilotkit/aimock@$(node -p 'require("/tmp/novedu-package.json").devDependencies["@copilotkit/aimock"]')" \
    && rm /tmp/novedu-package.json \
    && npm cache clean --force

COPY fake-llm/server.mjs fake-llm/markers.mjs ./

USER node
ENV FAKE_LLM_HOST=0.0.0.0 \
    FAKE_LLM_PORT=4010
EXPOSE 4010
CMD ["node", "server.mjs"]
