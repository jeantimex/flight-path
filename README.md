# Flight Path Visualization

A stunning 3D interactive flight path visualization built with Three.js, featuring real-time flight simulation around a photorealistic Earth with GPU-accelerated rendering for optimal performance.

https://github.com/user-attachments/assets/accd0313-8967-42b9-b41a-43e3467a78f1

[Flight Path Demo](https://jeantimex.github.io/flight-path/)

## 🌟 Features

### 🌍 Earth Visualization

- **Photorealistic 3D Earth** with high-resolution textures
- **Atmospheric effects** with dynamic scattering simulation
- **Real-time day/night cycles** based on actual sun positioning
- **Interactive camera controls** with smooth orbital navigation

### ✈️ Flight Simulation

- **Real flight data visualization** or procedurally generated paths
- **GPU-accelerated rendering** supporting thousands of simultaneous flights
- **Dynamic flight paths** with realistic parabolic trajectories
- **Customizable aircraft models** with SVG-based plane designs
- **Return flight simulation** with bidirectional path animation

### 🎮 Interactive Controls

Organized GUI interface with intuitive control panels:

#### Flight Controls

- **Flight Count**: Adjust number of visible flights (1-30,000)
- **Return Flight**: Toggle bidirectional flight animation

#### Flight Path

- **Dash Length**: Customize path line dash size
- **Dash Gap**: Adjust spacing between dashes
- **Hide Path**: Toggle flight path visibility

#### Plane Controls

- **Plane Size**: Scale aircraft models (50-500)
- **Plane Color**: Customize aircraft colors with color picker
- **Fly Speed**: Control animation speed (0.01-0.5)
- **Plane Elevation**: Adjust flight altitude above surface
- **Plane Style**: Switch between geometric shapes and SVG designs
- **Hide Plane**: Toggle aircraft visibility

#### Earth Controls

- **Day/Night Effect**: Enable realistic lighting simulation
- **Atmosphere Effect**: Toggle atmospheric visual effects
- **Real-time Sun**: Use current UTC time for sun positioning
- **Time (UTC)**: Display current simulated time
- **Time Slider**: Manual time control (0-24 hours)

#### Brightness Controls

- **Day Brightness**: Adjust daylight intensity (0-3.0)
- **Night Brightness**: Control ambient lighting (0-2.0)

### 🚀 Performance Features

- **GPU Instance Rendering**: Optimized for thousands of flights
- **Custom Shader Implementation**: High-performance graphics pipeline
- **Real-time Performance Monitoring**: Built-in FPS counter
- **Memory Efficient**: Intelligent resource management
- **Responsive Design**: Smooth 60fps animation on modern hardware

### 🎨 Visual Effects

- **Gradient Flight Paths**: Color-coded routes based on geographic regions
- **Smooth Animations**: Interpolated aircraft movement along curves
- **Dynamic Lighting**: Realistic sun positioning and shadows
- **Starfield Background**: Immersive space environment
- **Coordinate Display**: Real-time lat/lng positioning

## 🛠 Installation & Setup

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn package manager
- Modern web browser with WebGL support

### Quick Start

1. **Clone the repository**

   ```bash
   git clone https://github.com/jeantimex/flight-path.git
   cd flight-path
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start development server**

   ```bash
   npm run dev
   ```

4. **Open in browser**
   ```
   http://localhost:5173
   ```

### Build for Production

```bash
# Build optimized production bundle
npm run build

# Preview production build locally
npm run preview

# Deploy to GitHub Pages
npm run deploy
```

## 🎯 Usage

### Basic Navigation

- **Mouse drag**: Rotate camera around Earth
- **Mouse wheel**: Zoom in/out
- **GUI panels**: Adjust visualization parameters in real-time

### Performance Tips

- Start with fewer flights (1000-5000) and increase gradually
- Use "Hide Path" or "Hide Plane" to focus on specific elements
- Enable performance monitoring with 'P' key (development mode)

### Customization

- Modify flight data in `src/Data.js` for custom routes
- Add new aircraft designs by placing SVG files in `public/` directory
- Adjust shader parameters in `src/shaders/` for visual effects

## 🏗 Technical Architecture

### Core Technologies

- **Three.js**: 3D graphics and WebGL rendering
- **Vite**: Fast build tool and development server
- **dat.GUI**: Real-time control interface
- **Custom Shaders**: GLSL vertex/fragment shaders for performance

### Key Components

- `src/main.js`: Application entry point and scene setup
- `src/Controls.js`: Organized GUI control system
- `src/PanesShader.js`: GPU-accelerated aircraft rendering
- `src/Curves.js`: Optimized flight path rendering
- `src/Earth.js`: Planet visualization with atmosphere
- `src/Flight.js`: Individual flight simulation logic

### Performance Optimizations

- **Instanced Rendering**: Single draw call for multiple aircraft
- **Geometry Batching**: Merged meshes for reduced GPU overhead
- **Shader-based Animation**: GPU-computed movement and rotation
- **Level of Detail**: Adaptive quality based on camera distance

## 📊 Browser Support

- Chrome 60+ (recommended)
- Firefox 55+
- Safari 12+
- Edge 79+

_WebGL 2.0 support required for optimal performance_

## 🤝 Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues for bugs and feature requests.

### Development Setup

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and test thoroughly
4. Commit with clear messages: `git commit -m "Add feature description"`
5. Push to your fork: `git push origin feature-name`
6. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Three.js community for excellent 3D graphics framework
- OpenFlights.org for flight route data
- NASA for Earth texture resources
- dat.GUI for developer-friendly controls

## 🔗 Links

- **Live Demo**: [https://jeantimex.github.io/flight-path/](https://jeantimex.github.io/flight-path/)
- **Repository**: [https://github.com/jeantimex/flight-path](https://github.com/jeantimex/flight-path)
- **Issues**: [https://github.com/jeantimex/flight-path/issues](https://github.com/jeantimex/flight-path/issues)

---

Made with ❤️ by [jeantimex](https://github.com/jeantimex)
