package com.hitlist.web;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ApiFallbackController {
    @RequestMapping("/api/**")
    void unknown(HttpServletRequest request) {
        throw new ApiException(
            HttpStatus.NOT_FOUND,
            "not_found",
            "No API route for " + request.getMethod() + " " + request.getRequestURI()
        );
    }
}
