Comprehensive Engineering Report: Single-Shot Monocular Reconstruction and Real-Time Relighting Pipeline (2025)
1. Introduction: The Renaissance of Single-Shot 3D
The domain of computer vision and computer graphics has witnessed a paradigmatic shift by 2025, moving from reconstruction techniques dependent on multi-view photogrammetry to generative AI pipelines capable of hallucinating plausible 3D geometry from a single monocular RGB image. This transformation is driven by the maturation of foundation models that encode vast amounts of geometric and semantic priors, effectively allowing machines to "imagine" the occluded dimensions of a 2D scene.
This report articulates a comprehensive engineering plan for constructing a production-grade "single-photo to pseudo-3D" pipeline. The objective is to transform a flat image into a geometrically layered, physically material-aware 3D scene that supports real-time interaction and dynamic relighting within a web browser. The architecture leverages the convergence of three critical technological advancements:
1. Vision Transformers (ViT) and Diffusion Models for dense geometric estimation (depth, normals) and semantic segmentation.
2. Inverse Rendering Frameworks that decompose pixels into physically based rendering (PBR) textures (albedo, roughness, metallic).
3. WebGPU and Compute Shaders, enabling desktop-class rendering techniques—such as Percentage-Closer Soft Shadows (PCSS) and ray-traced global illumination approximations—directly in the client browser.
The proposed pipeline is a hybrid system. It utilizes lightweight, quantized inference on the client side for immediate interactivity (e.g., using Depth Anything V2 Small and SAM 2 Tiny) while offloading heavy generative tasks (e.g., Metric3D v2, TRELLIS, Stable Diffusion 3.5) to a GPU-accelerated backend. This report analyzes the theoretical underpinnings, architectural choices, and optimization strategies required to build this system, ensuring it meets the dual mandates of high fidelity and low latency.
________________
2. The Vision Layer: Monocular Geometric Inference
The foundation of any single-shot reconstruction pipeline is the accurate recovery of scene geometry from a 2D projection. The traditional challenge of monocular depth estimation (MDE) is its inherent ill-posed nature: infinite 3D scenes can project to the same 2D image. In 2025, this ambiguity is resolved not by geometric constraints alone, but by leveraging "priors" learned from massive datasets.
2.1 Depth Estimation Paradigms: Discriminative vs. Generative
Two distinct modeling philosophies currently dominate the landscape: discriminative models, which regress a single deterministic depth map, and generative models, which sample a probabilistic distribution of possible depth maps.
2.1.1 Depth Anything V2: The Discriminative Foundation
Depth Anything V2 represents the current state-of-the-art in discriminative MDE. Unlike earlier CNN-based approaches, it utilizes a Vision Transformer (ViT) architecture, specifically leveraging a DINOv2 backbone.1
* Architectural Nuance: The model's strength lies in its DINOv2-DPT architecture. DINOv2 is a self-supervised vision transformer trained to produce robust, object-centric features. The DPT (Dense Prediction Transformer) decoder is critical; unlike V1, which unintentionally utilized features from only the last four layers, V2 actively aggregates intermediate features from the encoder. This multi-scale feature fusion allows the model to preserve fine-grained details—such as the thin geometric structures of chair legs or tree branches—that are often lost in pure regression tasks.2
* Training Methodology: The training employs a robust teacher-student framework. A massive teacher model (ViT-Giant, 1.3 billion parameters) is first trained on high-precision synthetic datasets like Hypersim and BlendedMVS. Synthetic data provides perfect ground-truth depth, free from the sensor noise found in LiDAR or Kinect data.1 This teacher then annotates a massive dataset of 62 million unlabeled real-world images. The student models (Small, Base, Large) are trained on this "pseudo-labeled" data, effectively distilling the teacher's geometric reasoning into a computationally efficient package.3
* Loss Functions: To ensure edge fidelity, the training incorporates scale- and shift-invariant losses combined with a gradient-matching term. This ensures that even if the absolute depth scale is ambiguous, the relative discontinuities (edges) are sharp and consistent.1
* Deployment Profile: The Depth Anything V2 Small (25M parameters) variant is the ideal candidate for client-side inference. It can be executed in the browser via ONNX Runtime Web (utilizing WebGPU backend), providing near-instantaneous depth previews (<30ms latency on modern GPUs).2
2.1.2 Metric3D v2: Solving the Scale Ambiguity
While Depth Anything V2 provides excellent relative depth, applications requiring physics interactions (e.g., placing a virtual light source that respects inverse-square falloff) demand metric depth. Metric3D v2 addresses the "scale ambiguity" problem where diverse camera focal lengths distort the perceived distance of objects.5
* Canonical Camera Space: The core innovation of Metric3D v2 is its input transformation module. It warps input images into a "canonical camera space" effectively normalizing the intrinsic parameters (focal length and sensor size). This removes the variance caused by different capture devices, allowing the network to learn consistent metric features from a heterogeneous training set of over 16 million images.5
* Joint Optimization: Crucially, Metric3D v2 employs a joint depth-normal optimization module. Surface normals are the local derivatives of the depth map. By training the network to predict both simultaneously and enforcing geometric consistency between them, the model produces depth maps with locally planar surfaces and sharp creases, avoiding the "wavy" distortions common in pure depth regression.7
* Performance: It achieves state-of-the-art zero-shot performance on metric recovery. For our pipeline, Metric3D v2 is the preferred server-side model. It provides the "ground truth" geometry (absolute Z-values) used to displace the final mesh, ensuring that the 3D scene aligns with real-world dimensions.8
2.1.3 Marigold: Generative Refinement and Inpainting
Marigold (and its successor Marigold-DC) introduces a generative approach by repurposing Latent Diffusion Models (LDMs), specifically Stable Diffusion, for depth estimation.9
* Mechanism: Marigold does not regress depth directly. Instead, it fine-tunes the Stable Diffusion U-Net to "denoise" a latent representation of depth, conditioned on the input RGB image. Because it starts from a pre-trained image generator, it inherits a vast visual prior. This allows it to "hallucinate" plausible geometric details in textureless regions (e.g., a white wall) where discriminative models might fail or output noise.11
* Depth Completion (Marigold-DC): This variant is essential for the occlusion handling phase of our pipeline. Marigold-DC formulates depth estimation as a conditional generation task: $p(D | I, D_{sparse})$. It can take an image $I$ and a sparse set of known depth points $D_{sparse}$ (e.g., the depth values from the foreground object edges) and generate a dense depth map for the occluded background that is geometrically consistent with those edge constraints.9
* Trade-offs: The diffusion process is computationally expensive, requiring multi-step inference (typically 10-50 steps). This makes Marigold unsuitable for real-time interaction but perfect for high-fidelity offline processing or filling in large disoccluded regions where plausibility is more important than raw speed.12
2.2 Semantic Segmentation: Segment Anything Model 2 (SAM 2)
Geometry provides the shape, but semantics provide the structure. To allow users to manipulate specific objects (e.g., "relight just the chair"), we integrate Segment Anything Model 2 (SAM 2).13
* Architecture: SAM 2 improves upon the original SAM by using a Hiera (Hierarchical) image encoder. This encoder is significantly faster (6x) than the ViT-H utilized in SAM 1 while maintaining comparable accuracy.14
* Occlusion Awareness: A critical feature for 3D reconstruction is SAM 2's "occlusion head." This module predicts whether an object is fully visible, partially occluded, or out of frame. In a single-shot reconstruction context, detecting occlusion is vital; it signals to the pipeline that the geometry behind an occluded object is unknown and must be synthesized via inpainting.16
* Streaming Memory: While primarily designed for video, SAM 2's memory mechanism (which stores "object pointers" and past frame features) allows for temporally consistent segmentation if the user provides a "live photo" or short burst sequence instead of a single static image. This enables the pipeline to aggregate geometric cues across slightly shifted viewpoints, improving 3D fidelity.13
* Deployment: The prompt encoder and mask decoder of SAM 2 are lightweight enough to run entirely in the browser via ONNX Runtime. This enables a zero-latency "click-to-segment" interaction model where the user selects objects to be separated into distinct 3D layers.4
2.3 Integration Strategy
The optimal engineering strategy for 2025 creates a hierarchy of inference:
1. Immediate Feedback (Client): Depth Anything V2 Small generates a relative depth map in the browser (<50ms) to drive immediate UI effects like parallax mouse-hover. SAM 2 (Tiny) enables instant object selection.
2. High-Fidelity Reconstruction (Server): The selected image is sent to the backend where Metric3D v2 computes absolute metric depth and surface normals. This ensures physics-compliant scaling.
3. Refinement (Server): For regions with high uncertainty or disocclusion, Marigold-DC is invoked to hallucinate geometrically consistent gap-filling depth.
________________
3. The Semantic Layer: Material Estimation and Inverse Rendering
A standard photo captures "radiance"—the combination of lighting and material properties. To relight a scene, we must "inverse render" it: decomposing the image back into its constituent material properties (Albedo, Roughness, Metallic) and lighting environment.
3.1 Inverse Rendering Frameworks: Materialist
Materialist is the designated framework for this pipeline, offering a robust approach to single-image inverse rendering.17
* Progressive Differentiable Rendering: Unlike simple regression networks, Materialist uses an iterative optimization loop.
   1. Prediction: A neural network (MaterialNet) predicts initial buffers for Albedo, Roughness, and Metallic, along with an estimated Environment Map.
   2. Synthesis: A differentiable renderer (based on Mitsuba) renders the scene using these predicted properties.
   3. Optimization: The difference between the rendered image and the original input is calculated. Gradients are backpropagated to refine the material parameters and the environment map, ensuring the physical consistency of the predicted materials.18
* Transparency Handling: A unique capability of Materialist is its ability to handle transparent and translucent objects (like glass or water). It predicts refraction parameters that are typically ignored by other estimators, allowing our 3D reconstruction to accurately render complex materials.20
* Shadows and Global Illumination: By estimating the environment map, Materialist allows us to not only relight the object but also to capture the original lighting context. This "Environment Map" is crucial for the web renderer to output realistic reflections via Image-Based Lighting (IBL).17
3.2 Single-Step Estimators: SuperMat
For applications where the iterative optimization of Materialist is too slow (e.g., <2 seconds latency required), SuperMat offers a viable alternative. It uses a specialized architecture to decompose materials in a single forward pass. While potentially less physically rigorous than Materialist's optimization loop, it provides a high-speed approximation of PBR maps that is sufficient for many visual effects.21
Engineering Implementation:
The pipeline generates a standard PBR texture set (Albedo, Normal, Roughness, Metalness, AO).
* Albedo: Derived from the base image, but "delit" (shadows and highlights removed) using the inverse rendering output.
* Normals: High-precision normal map from Metric3D v2.
* Roughness/Metallic: Inferred maps from Materialist.
These maps are packed into efficient texture formats (e.g., KTX2) for transmission to the browser.
________________
4. The Reconstruction Layer: From 2.5D to 3D
With dense geometry and materials extracted, the system must construct a 3D representation. In 2025, the choice is between explicit mesh-based Layered Depth Images (LDI) and implicit/volumetric approaches like 3D Gaussian Splatting (3DGS).
4.1 Layered Depth Images (LDI) & Mesh Displacement
For "pseudo-3D" scenes where the viewpoint is restricted to a frontal hemisphere (e.g., ±30 degrees parallax), the LDI approach offers the best balance of performance and visual quality.
   * Layer Decomposition: Using the masks from SAM 2, the scene is sliced into depth layers (e.g., Foreground Object, Mid-ground, Background).
   * Mesh Generation: Each layer is converted into a high-density plane mesh. The vertex density must be sufficient to support the frequency of the depth map details.
   * Displacement: Vertices are displaced along the Z-axis (camera view axis) using the metric depth values from Metric3D.
   * Engineering Note: To prevent "stretching" artifacts at object boundaries, the mesh is disconnected at depth discontinuities. Edge vertices of the foreground mesh are extruded backward (along the camera ray) to create a "watertight" volume, preventing gaps from appearing when the camera rotates slightly.
4.2 Generative Inpainting: Filling the Void
Moving the camera reveals the "disoccluded" regions—the empty space behind foreground objects. These voids must be filled with plausible content.
   * Geometric Inpainting (Marigold-DC): Before painting pixels, we must paint geometry. Marigold-DC takes the sparse depth data of the background (surrounding the hole) and inpaints the missing depth values. This ensures that the new texture is projected onto a surface that sits at the correct depth, rather than floating in space.9
   * Texture Inpainting (Stable Diffusion 3.5 + ControlNet): Once the geometry is restored, we use Stable Diffusion 3.5 equipped with a Depth-ControlNet. The ControlNet uses the inpainted depth map as a structural guide, ensuring the generated texture (e.g., continuing a tiled floor pattern or a brick wall) aligns perfectly with the perspective and scale of the scene. BrushNet, a dual-branch diffusion variant, can be used for even higher coherence, as it processes masked features separately to preserve the integrity of the unmasked regions.24
4.3 Volumetric Reconstruction: LGM and TRELLIS
For use cases demanding full 360-degree rotation (e.g., e-commerce product viewing), the LDI approach fails. Here, we employ Single-Image 3D Gaussian Splatting.
   * LGM (Large Multi-view Gaussian Model): LGM leverages a diffusion model to hallucinate four orthogonal views of the object. These views are fed into an asymmetric U-Net backbone, which directly regresses the parameters (position, covariance, color, opacity) of thousands of 3D Gaussians. It can generate a high-resolution 3DGS representation in approximately 5 seconds.27
   * TRELLIS: TRELLIS represents the cutting edge of unified 3D generation. It uses a "Structured Latent" (SLAT) representation—a sparse 3D grid of features generated by a rectified flow transformer.
   * Versatility: TRELLIS can decode this SLAT representation into multiple formats: Radiance Fields for high-quality offline rendering, 3D Gaussians for real-time web viewing, or Meshes for physics collisions. This flexibility makes it the superior choice for a production pipeline that needs to support various client capabilities.29
Recommendation: For the primary "pseudo-3D" photo viewer, use the LDI/Mesh approach. It is computationally cheaper to render and easier to integrate with standard web physics. Use TRELLIS on the backend only if the user explicitly requests a full 360-degree object extraction.
________________
5. The Rendering Layer: Real-Time WebGPU Graphics
The final delivery mechanism is a web browser. In 2025, WebGPU has superseded WebGL as the standard for high-performance graphics, enabling compute shaders and complex lighting models previously restricted to native applications.
5.1 WebGPU and Three.js Shading Language (TSL)
Three.js has adopted TSL (Three.js Shading Language), a node-based abstraction that transpiles to WGSL (WebGPU Shading Language). TSL allows developers to compose shader logic using JavaScript objects ("Nodes"), providing modularity and type safety.31
   * Compute Shaders: WebGPU enables the use of compute shaders for heavy parallel tasks. In our pipeline, compute shaders are essential for:
   * Gaussian Splat Sorting: If rendering 3DGS, the millions of splats must be sorted by depth every frame. Doing this on the CPU (JavaScript) is a bottleneck; WebGPU compute shaders handle it effortlessly.33
   * Frustum Culling: Efficiently culling geometry that falls outside the camera view before it reaches the rasterizer.
5.2 Advanced Shadow Techniques: PCSS & VSM
To create believable "depth-aware" light, standard shadow maps are insufficient. Real lights cast soft shadows that blur as distance increases (contact hardening).
   * Percentage-Closer Soft Shadows (PCSS): This is the gold standard for real-time soft shadows. In WebGPU/TSL, PCSS is implemented as a custom node 35:
   1. Blocker Search: The shader samples the shadow map in a search radius to find "blockers" (objects between the light and the receiver).
   2. Penumbra Estimation: It calculates the average depth of these blockers. Using similar triangles (based on the physical size of the light source), it computes how wide the penumbra should be at the receiver's surface.
   3. Filtering: It performs Percentage-Closer Filtering (PCF) using a kernel size dynamically determined by the penumbra width.
   * Implementation: Three.js PhysicalSpotLight supports a .radius property that drives this calculation in the TSL pipeline.36
   * Cascaded Shadow Maps (CSM): For larger scenes, CSM is implemented to manage shadow resolution across distances. The camera frustum is split into cascades (e.g., near, mid, far). A TSL node determines the pixel's depth and samples from the appropriate high-res or low-res shadow map, ensuring crisp shadows near the viewer without wasting memory on distant objects.38
5.3 Physically Based Rendering (PBR) Pipeline
To utilize the maps extracted by Materialist, we construct a MeshStandardNodeMaterial in TSL.
   * Material Definition:
JavaScript
const material = new THREE.MeshStandardNodeMaterial();
material.colorNode = texture(albedoMap);
material.roughnessNode = texture(roughnessMap);
material.metalnessNode = texture(metallicMap);
material.normalNode = texture(normalMap); // Metric3D normals

   * Image-Based Lighting (IBL): Realistic reflections are achieved using the Environment Map generated by Materialist. This HDR map is convolved to create irradiance (diffuse) and radiance (specular) maps, enabling the metallic parts of the reconstruction to reflect the original scene context.37
________________
6. Engineering the Pipeline: Deployment & Optimization
Moving from research code to a production web app requires rigorous optimization, particularly regarding model size and inference latency.
6.1 Model Quantization: INT8 vs. FP16
Running gigabyte-scale models is feasible on servers but challenging for browsers.
      * ONNX Runtime: All models (Depth Anything, SAM 2) should be exported to ONNX format for interoperability.
      * Quantization Strategy:
      * FP16 (Half Precision): This is the recommended format for WebGPU execution. Most modern GPUs (including mobile) have dedicated FP16 tensor cores. Benchmarks indicate FP16 reduces memory bandwidth by 50% with negligible accuracy loss.39
      * INT8: While INT8 offers 4x compression, it requires careful calibration (using datasets to determine dynamic ranges of activations) to avoid significant accuracy degradation, particularly in Transformer architectures where activation outliers can destroy quantization precision. INT8 is best reserved for CPU/WASM fallbacks where FP16 support is lacking.41
      * FP8: While supported on server-side NVIDIA H100s for massive throughput, FP8 is not yet mature in browser runtimes (ONNX Runtime Web) and should generally be avoided for client-side deployment in 2025.41
6.2 System Architecture: Client-Server Split
A hybrid architecture balances the need for immediate responsiveness with high-fidelity generation.
Component
	Location
	Technology
	Rationale
	User Interaction
	Client
	SAM 2 (Tiny) + WebGPU
	Zero-latency object selection and masking.
	Preview Geometry
	Client
	Depth Anything V2 (Small)
	Instant parallax feedback (<50ms latency).
	High-Res Geometry
	Server
	Metric3D v2
	Requires significant VRAM for metric accuracy.
	Texture/Material
	Server
	Materialist / SuperMat
	Complex inverse rendering optimization loop.
	Inpainting
	Server
	SD 3.5 + ControlNet + Marigold-DC
	Diffusion models are too heavy for mobile browsers.
	3D Generation
	Server
	TRELLIS
	Large transformer model (2B params).
	Rendering
	Client
	Three.js + TSL (WebGPU)
	Utilizing client GPU for display and shadows.
	6.3 Browser Implementation: Transformers.js
For the client-side components, Transformers.js (v3) is the engine of choice. It enables running PyTorch-derived models directly in the browser using the WebGPU backend.4
      * Pipeline API: The library provides a simple API to load quantized ONNX models.
JavaScript
import { pipeline } from '@xenova/transformers';
const depthEstimator = await pipeline('depth-estimation', 'Xenova/depth-anything-v2-small', { device: 'webgpu' });

      * SAM 2 in Browser: While the heavy image encoder of SAM 2 usually runs once (potentially on the server), the lightweight prompt encoder and mask decoder can be run entirely client-side. This decoupling allows the user to click and refine masks in real-time without round-trips to the server for every interaction.4
________________
7. Comparative Analysis & Benchmarks
To justify the architectural choices, we compare the selected components against alternatives.
Depth Estimation:
         * Depth Anything V2 vs. MiDaS: DA-V2 is significantly sharper and handles fine details (hair, foliage) better than MiDaS, which tends to over-smooth.
         * Metric3D v2 vs. ZoeDepth: Metric3D v2 offers superior zero-shot metric accuracy due to its canonical space transformation, whereas ZoeDepth often struggles with unseen camera intrinsics.
3D Representation:
         * LDI (Mesh) vs. 3DGS (Splats): LDI is rendering-efficient and compatible with standard physics engines (Ammo.js, Havok). 3DGS offers better visual fidelity for fuzzy objects (hair, fur) but requires a specialized sorting renderer and is harder to integrate with physics.
Inpainting:
         * SD 3.5 vs. SD 1.5: SD 3.5 follows prompts significantly better and understands complex spatial relationships, reducing the "hallucination artifacts" where inpainting generates objects that don't fit the scene perspective.
________________
8. Future Directions
The trajectory of this technology points toward 4D Reconstruction (3D + Time). Models like Video Depth Anything 2 and SAM 2 (video mode) are already paving the way for reconstructing dynamic scenes from video inputs.
         * End-to-End Generative 3D: We anticipate the rise of "Large Reconstruction Models" (LRMs) that skip the intermediate depth map stage entirely, outputting neural radiance fields or splats directly from pixels in a single feed-forward pass, potentially running efficiently on client-side NPUs (Neural Processing Units).
         * Browser-Native Ray Tracing: As the WebGPU standard matures, hardware-accelerated ray tracing extensions will likely become available, making techniques like PCSS obsolete in favor of true, physically correct ray-traced shadows and reflections.44
________________
Conclusion
The engineering pipeline outlined above represents the apex of what is possible in 2025. By intelligently distributing the workload—using fast discriminative models on the client for interactivity and heavy generative/metric models on the server for fidelity—we can achieve a user experience that feels magical. The integration of Metric3D v2 ensures physical plausibility, Materialist guarantees photorealistic relighting, and WebGPU/TSL brings cinema-quality rendering to the open web. This is not merely a theoretical exercise; it is a blueprint for the next generation of immersive digital media.
Works cited
         1. Depth Anything v2: Monocular Depth Estimation - Emergent Mind, accessed December 24, 2025, https://www.emergentmind.com/topics/depth-anything-v2-1cdf50d8-fc6d-44e2-b8d1-476c3c0533f5
         2. DepthAnything/Depth-Anything-V2: [NeurIPS 2024] Depth ... - GitHub, accessed December 24, 2025, https://github.com/DepthAnything/Depth-Anything-V2
         3. Depth Anything V2, accessed December 24, 2025, https://depth-anything-v2.github.io/
         4. Image Segmentation in the Browser with Segment Anything Model 2, accessed December 24, 2025, https://medium.com/@geronimo7/in-browser-image-segmentation-with-segment-anything-model-2-c72680170d92
         5. A Versatile Monocular Geometric Foundation Model for Zero-shot ..., accessed December 24, 2025, https://arxiv.org/abs/2404.15506
         6. Metric3D v2: A Versatile Monocular Geometric Foundation Model for ..., accessed December 24, 2025, https://arxiv.org/pdf/2404.15506?
         7. Metric3D-v2, accessed December 24, 2025, https://jugghm.github.io/Metric3Dv2/
         8. Metric3D v2: A Versatile Monocular Geometric Foundation Model for ..., accessed December 24, 2025, https://pubmed.ncbi.nlm.nih.gov/39150798/
         9. Zero-Shot Monocular Depth Completion with Guided Diffusion, accessed December 24, 2025, https://openaccess.thecvf.com/content/ICCV2025/papers/Viola_Marigold-DC_Zero-Shot_Monocular_Depth_Completion_with_Guided_Diffusion_ICCV_2025_paper.pdf
         10. prs-eth/Marigold: [CVPR 2024 - Oral, Best Paper Award ... - GitHub, accessed December 24, 2025, https://github.com/prs-eth/Marigold
         11. Marigold-DC Depth Completion Model - Emergent Mind, accessed December 24, 2025, https://www.emergentmind.com/topics/marigold-dc-diffusion-based-depth-completion-model
         12. prs-eth/marigold-depth-v1-0 - Hugging Face, accessed December 24, 2025, https://huggingface.co/prs-eth/marigold-depth-v1-0
         13. SAM 2: SEGMENT ANYTHING IN IMAGES AND VIDEOS, accessed December 24, 2025, https://openreview.net/pdf?id=Ha6RTeWMd0
         14. SAM 2: Segment Anything in Images and Videos - arXiv, accessed December 24, 2025, https://arxiv.org/html/2408.00714v1
         15. Segment Anything 2 (SAM2) in Supervisely: The Fast and Accurate ..., accessed December 24, 2025, https://supervisely.com/blog/segment-anything-2-for-automatically-segment-and-track-objects/
         16. SAM 2: Segment Anything Model 2 - Ultralytics YOLO Docs, accessed December 24, 2025, https://docs.ultralytics.com/models/sam-2/
         17. Physically Based Editing Using Single-Image Inverse Rendering, accessed December 24, 2025, https://arxiv.org/abs/2501.03717
         18. Physically Based Editing Using Single-Image Inverse Rendering, accessed December 24, 2025, https://arxiv.org/html/2501.03717v2
         19. lez-s/Materialist: Materialist: Physically Based Editing Using ... - GitHub, accessed December 24, 2025, https://github.com/lez-s/Materialist
         20. Physically Based Editing Using Single-Image Inverse Rendering, accessed December 24, 2025, https://arxiv.org/html/2501.03717v1
         21. Physically Consistent PBR Material Estimation at Interactive Rates, accessed December 24, 2025, https://openaccess.thecvf.com/content/ICCV2025/papers/Hong_SuperMat_Physically_Consistent_PBR_Material_Estimation_at_Interactive_Rates_ICCV_2025_paper.pdf
         22. SuperMat: Physically Consistent PBR Material Estimation at ... - arXiv, accessed December 24, 2025, https://arxiv.org/html/2411.17515v3
         23. Marigold-DC: Zero-Shot Monocular Depth Completion with Guided ..., accessed December 24, 2025, https://marigolddepthcompletion.github.io/
         24. BrushNet: A Plug-and-Play Image Inpainting Model ... - ResearchGate, accessed December 24, 2025, https://www.researchgate.net/publication/386174419_BrushNet_A_Plug-and-Play_Image_Inpainting_Model_with_Decomposed_Dual-Branch_Diffusion
         25. Stable Diffusion - Wikipedia, accessed December 24, 2025, https://en.wikipedia.org/wiki/Stable_Diffusion
         26. stabilityai/stable-diffusion-3.5-controlnets - Hugging Face, accessed December 24, 2025, https://huggingface.co/stabilityai/stable-diffusion-3.5-controlnets
         27. LGM: Large Multi-View Gaussian Model for High-Resolution 3D ..., accessed December 24, 2025, https://researchdata.ntu.edu.sg/dataset.xhtml?persistentId=doi:10.21979/N9/27JLJB
         28. LGM: Large Multi-View Gaussian Model for High-Resolution 3D ..., accessed December 24, 2025, https://arxiv.org/abs/2402.05054
         29. microsoft/TRELLIS: Official repo for paper "Structured 3D ... - GitHub, accessed December 24, 2025, https://github.com/microsoft/TRELLIS
         30. TRELLIS: Structured 3D Latents for Scalable and Versatile 3D ..., accessed December 24, 2025, https://trellis3d.github.io/
         31. Three.js Shading Language - GitHub, accessed December 24, 2025, https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language
         32. WebGPU / TSL - Wawa Sensei, accessed December 24, 2025, https://wawasensei.dev/courses/react-three-fiber/lessons/webgpu-tsl
         33. WebGL vs. WebGPU Explained - Three.js Roadmap, accessed December 24, 2025, https://threejsroadmap.com/blog/webgl-vs-webgpu-explained
         34. Interactive Galaxy with WebGPU Compute Shaders, accessed December 24, 2025, https://threejsroadmap.com/blog/galaxy-simulation-webgpu-compute-shaders
         35. Soft Shadows for Mobile AR - Medium, accessed December 24, 2025, https://medium.com/@varunm100/soft-shadows-for-mobile-ar-9e8da2e6f4ba
         36. Soft Shadows - Three.js Tutorials, accessed December 24, 2025, https://sbcode.net/threejs/soft-shadows/
         37. gkjohnson/three-gpu-pathtracer: Path tracing renderer and ... - GitHub, accessed December 24, 2025, https://github.com/gkjohnson/three-gpu-pathtracer
         38. Cascaded Shadow Maps (CSM) on WebGPU - three.js forum, accessed December 24, 2025, https://discourse.threejs.org/t/cascaded-shadow-maps-csm-on-webgpu/84235
         39. Understanding FP32, FP16, and INT8 Precision in Deep Learning ..., accessed December 24, 2025, https://medium.com/@vishalindev/understanding-fp32-fp16-and-int8-precision-in-deep-learning-models-why-int8-calibration-is-5406b1c815a8
         40. FP8, BF16, and INT8: How Low-Precision Formats Are ... - Medium, accessed December 24, 2025, https://medium.com/@StackGpu/fp8-bf16-and-int8-how-low-precision-formats-are-revolutionizing-deep-learning-throughput-e6c1f3adabc2
         41. FP8: Efficient model inference with 8-bit floating point numbers, accessed December 24, 2025, https://www.baseten.co/blog/fp8-efficient-model-inference-with-8-bit-floating-point-numbers/
         42. FP8 quantized results are bad compared to int8 results - Reddit, accessed December 24, 2025, https://www.reddit.com/r/LocalLLaMA/comments/18ctfs6/fp8_quantized_results_are_bad_compared_to_int8/
         43. huggingface/transformers.js: State-of-the-art Machine Learning for ..., accessed December 24, 2025, https://github.com/huggingface/transformers.js/
         44. Webgpu Raytracer - Three.js Resources, accessed December 24, 2025, https://threejsresources.com/tool/webgpu-raytracer