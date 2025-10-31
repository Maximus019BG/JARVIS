#include <EGL/egl.h>
#include <GLES2/gl2.h>
#include <iostream>
#include <unistd.h>

static const char *vertexShaderSource =
    "attribute vec2 aPos;"
    "void main() {"
    "   gl_Position = vec4(aPos, 0.0, 1.0);"
    "}";

static const char *fragmentShaderSource =
    "precision mediump float;"
    "void main() {"
    "   gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);" // white color
    "}";

GLuint loadShader(GLenum type, const char *source) {
    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &source, NULL);
    glCompileShader(shader);
    return shader;
}

int main() {
    // 1. Initialize EGL
    EGLDisplay display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    eglInitialize(display, NULL, NULL);

    EGLint attribs[] = {
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
        EGL_NONE
    };
    EGLConfig config;
    EGLint numConfigs;
    eglChooseConfig(display, attribs, &config, 1, &numConfigs);

    EGLSurface surface = eglCreateWindowSurface(display, config, 0, NULL);

    EGLint ctxAttribs[] = { EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE };
    EGLContext context = eglCreateContext(display, config, EGL_NO_CONTEXT, ctxAttribs);

    eglMakeCurrent(display, surface, surface, context);

    // 2. Setup OpenGL
    GLuint vShader = loadShader(GL_VERTEX_SHADER, vertexShaderSource);
    GLuint fShader = loadShader(GL_FRAGMENT_SHADER, fragmentShaderSource);

    GLuint program = glCreateProgram();
    glAttachShader(program, vShader);
    glAttachShader(program, fShader);
    glLinkProgram(program);
    glUseProgram(program);

    // 3. Define a line (two vertices)
    GLfloat lineVertices[] = { -0.8f, -0.8f, 0.8f, 0.8f };
    GLint posAttrib = glGetAttribLocation(program, "aPos");
    glEnableVertexAttribArray(posAttrib);
    glVertexAttribPointer(posAttrib, 2, GL_FLOAT, GL_FALSE, 0, lineVertices);

    // 4. Draw
    glClearColor(0.0, 0.0, 0.0, 1.0);
    glClear(GL_COLOR_BUFFER_BIT);

    glDrawArrays(GL_LINES, 0, 2);

    eglSwapBuffers(display, surface);

    // Keep on screen for 5 seconds
    sleep(5);

    // 5. Cleanup
    eglDestroyContext(display, context);
    eglTerminate(display);

    return 0;
}
