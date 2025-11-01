// ai-model.h
// TODO: Define the real AI model API and data structures.
// This is a placeholder interface. Replace with your actual model loading/inference code.

#pragma once

#include <string>
#include <vector>

class AIModel {
public:
	AIModel() = default;
	~AIModel();

	// TODO: Choose appropriate initialization parameters (e.g., model path, device selection)
	bool initialize(const std::string& modelPath);

	// TODO: Replace float vectors with your actual tensor/image types
	bool infer(const std::vector<float>& input, std::vector<float>& output);

	// TODO: Add any cleanup logic needed for your backend (CUDA, OpenCL, CPU, etc.)
	void shutdown();

	// Non-copyable
	AIModel(const AIModel&) = delete;
	AIModel& operator=(const AIModel&) = delete;

	// Movable
	AIModel(AIModel&&) noexcept = default;
	AIModel& operator=(AIModel&&) noexcept = default;

private:
	// TODO: Store backend-specific handles/resources (e.g., session pointer, context)
	bool initialized_ = false;
};

