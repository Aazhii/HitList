package com.hitlist.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.web.SimpleRequestFilter;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Stream;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

@Configuration
@EnableConfigurationProperties(HitListProperties.class)
public class WebConfiguration {
    @Bean
    SimpleRequestFilter simpleRequestFilter(HitListProperties properties) {
        return new SimpleRequestFilter(properties);
    }

    @Bean
    WebMvcConfigurer webMvcConfigurer(HitListProperties properties, ObjectMapper objectMapper) {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                String[] origins = configuredOrigins(properties);
                if (origins.length == 0) {
                    return;
                }
                registry.addMapping("/**")
                    .allowedOrigins(origins)
                    .allowedMethods("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE")
                    .allowCredentials(true);
            }

            @Override
            public void extendMessageConverters(List<HttpMessageConverter<?>> converters) {
                converters.stream()
                    .filter(MappingJackson2HttpMessageConverter.class::isInstance)
                    .map(MappingJackson2HttpMessageConverter.class::cast)
                    .findFirst()
                    .ifPresent(converter -> {
                        converter.setObjectMapper(objectMapper);
                        converter.setSupportedMediaTypes(List.of(MediaType.APPLICATION_JSON, MediaType.TEXT_PLAIN));
                    });
            }

            @Override
            public void addResourceHandlers(ResourceHandlerRegistry registry) {
                registry.addResourceHandler("/**")
                    .addResourceLocations("classpath:/static/")
                    .resourceChain(false)
                    .addResolver(new PathResourceResolver() {
                        @Override
                        protected Resource getResource(String resourcePath, Resource location) throws IOException {
                            Resource asset = super.getResource(resourcePath, location);
                            if (asset != null) {
                                return asset;
                            }
                            if (resourcePath.startsWith("api/")) {
                                return null;
                            }
                            Resource index = location.createRelative("index.html");
                            return index.exists() && index.isReadable() ? index : null;
                        }
                    });
            }
        };
    }

    public static String[] configuredOrigins(HitListProperties properties) {
        String[] explicit = Arrays.stream(properties.getAllowedOrigins().split(","))
            .map(String::trim)
            .filter(value -> !value.isEmpty())
            .toArray(String[]::new);
        if (explicit.length > 0) {
            return explicit;
        }
        return Stream.of("http://localhost:9000", "http://127.0.0.1:9000", "http://localhost:4173")
            .toArray(String[]::new);
    }
}
