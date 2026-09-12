package com.kaizen.todo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@org.springframework.scheduling.annotation.EnableScheduling
public class KaizenTodoApplication {

    public static void main(String[] args) {
        SpringApplication.run(KaizenTodoApplication.class, args);
    }
}
