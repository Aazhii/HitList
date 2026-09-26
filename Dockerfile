FROM node:24-bookworm-slim AS frontend
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM maven:3.9-eclipse-temurin-25 AS backend
WORKDIR /workspace
COPY pom.xml ./
RUN --mount=type=cache,target=/root/.m2 mvn -B -q dependency:go-offline
COPY src/main/java src/main/java
COPY src/main/resources src/main/resources
COPY --from=frontend /workspace/dist src/main/resources/static
RUN --mount=type=cache,target=/root/.m2 mvn -B -q package -DskipTests

FROM eclipse-temurin:25-jre
WORKDIR /app
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75.0 -Djava.security.egd=file:/dev/./urandom"
COPY --from=backend /workspace/target/hitlist.jar ./hitlist.jar
RUN useradd --system --uid 10001 hitlist
USER hitlist
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/hitlist.jar"]
