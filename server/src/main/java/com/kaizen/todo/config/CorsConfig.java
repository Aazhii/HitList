package com.kaizen.todo.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Centralised CORS configuration.
 *
 * Allows the Vite dev server (port 5173) and any production origin
 * to call the Spring Boot API (port 8080).
 *
 * Individual controllers no longer need @CrossOrigin annotations.
 */
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns(
                        "http://localhost:5173",   // Vite dev server
                        "http://localhost:3000",   // CRA / alternative dev
                        "http://localhost:4173",   // Vite preview
                        "https://*.vercel.app",    // Vercel preview deploys
                        "https://*.netlify.app"    // Netlify preview deploys
                )
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(false)
                .maxAge(3600);
    }
}
