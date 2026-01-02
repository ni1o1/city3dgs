import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { SplatMesh } from '@sparkjsdev/spark'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

function SplatViewer() {
  const containerRef = useRef(null)
  const rendererRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const controlsRef = useRef(null)
  const splatRef = useRef(null)
  const raycasterRef = useRef(new THREE.Raycaster())
  const pointerRef = useRef(new THREE.Vector2())
  const [pois, setPois] = useState([])
  const [cameras, setCameras] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')  // 用于顶部提示
  const [arSupported, setArSupported] = useState(false)
  const [arActive, setArActive] = useState(false)
  const [orientationActive, setOrientationActive] = useState(false)
  const [activePoi, setActivePoi] = useState(null)
  const [activeCamera, setActiveCamera] = useState(null)
  const [sceneScale, setSceneScale] = useState(50)
  const [splatOffset, setSplatOffset] = useState([-0.1, -0.18, -0.1])  // 3DGS场景偏移 [x, y, z]
  const [isMobile, setIsMobile] = useState(false)
  const [isLandscape, setIsLandscape] = useState(true)
  const [showPoiIcons, setShowPoiIcons] = useState(true)
  const poiObjectsRef = useRef([])
  const poiLabelsRef = useRef([])  // HTML 标签元素
  const animRef = useRef(null)
  const orientationHandlerRef = useRef(null)
  const rootRef = useRef(null)

  // 动画状态锁
  const isAnimatingRef = useRef(false)
  // 保存 activePoi 的 ref，避免闭包问题
  const activePoiRef = useRef(null)

  // 同步 activePoi 到 ref
  useEffect(() => {
    activePoiRef.current = activePoi
  }, [activePoi])

  const generateCameraPosition = useCallback((poiPosition, cameraDirection) => {
    const [x, y, z] = poiPosition
    const [dx, dy, dz] = cameraDirection || [0, 0, -1]
    const distance = 2.0
    const cameraPos = [
      x - dx * distance,
      y - dy * distance + 0.5,
      z - dz * distance
    ]
    return cameraPos
  }, [])

  const moveToCamera = useCallback((camera, instant = false) => {
    if (!camera || !cameraRef.current || !controlsRef.current) return

    // 取消之前的动画
    if (animRef.current) {
      cancelAnimationFrame(animRef.current)
      animRef.current = null
    }

    const cam = cameraRef.current
    const controls = controlsRef.current

    const cameraPos = generateCameraPosition(camera.position, camera.cameraDirection)
    const targetPosition = new THREE.Vector3(...cameraPos)
    const targetLookAt = new THREE.Vector3(...camera.position)

    // 立即移动
    if (instant) {
      cam.position.copy(targetPosition)
      controls.target.copy(targetLookAt)
      cam.lookAt(controls.target)
      // 重置 controls 内部状态
      controls.enableDamping = false
      controls.update()
      controls.enableDamping = true
      return
    }

    // 1. 标记动画开始
    isAnimatingRef.current = true
    // 2. 完全禁用 controls
    controls.enabled = false

    const startPos = cam.position.clone()
    const startTarget = controls.target.clone()

    const duration = 1200
    const t0 = performance.now()

    const animate = () => {
      const t = performance.now()
      const elapsed = t - t0
      const k = Math.min(1, elapsed / duration)

      // Smooth easing
      const ease = 1 - Math.pow(1 - k, 3)

      // 插值相机位置和目标点
      cam.position.lerpVectors(startPos, targetPosition, ease)
      controls.target.lerpVectors(startTarget, targetLookAt, ease)
      cam.lookAt(controls.target)

      if (k < 1) {
        animRef.current = requestAnimationFrame(animate)
      } else {
        // 动画完成
        animRef.current = null

        // 确保最终位置精确
        cam.position.copy(targetPosition)
        controls.target.copy(targetLookAt)
        cam.lookAt(controls.target)

        // 关键：重置 OrbitControls 的内部状态
        // 临时禁用阻尼来强制同步
        controls.enableDamping = false
        controls.update()
        controls.enableDamping = true

        // 恢复交互（但如果陀螺仪模式开启，则保持 controls 禁用）
        if (!orientationHandlerRef.current) {
          controls.enabled = true
        }
        isAnimatingRef.current = false
      }
    }
    animRef.current = requestAnimationFrame(animate)
  }, [generateCameraPosition])

  useEffect(() => {
    const container = containerRef.current
    const width = container.clientWidth
    const height = container.clientHeight

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    rendererRef.current = renderer
    container.appendChild(renderer.domElement)
    renderer.domElement.style.position = 'absolute'
    renderer.domElement.style.left = '0'
    renderer.domElement.style.top = '0'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.zIndex = '0'

    const scene = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)
    camera.position.set(0, 0, 4)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.1
    controls.enableZoom = true
    controls.enablePan = false
    controls.minDistance = 0.1
    controls.maxDistance = 10
    controls.maxPolarAngle = Math.PI
    controls.minPolarAngle = 0
    controls.target.set(0, 0, 0)
    controlsRef.current = controls

    const light = new THREE.AmbientLight(0xffffff, 1)
    scene.add(light)

    const root = new THREE.Group()
    rootRef.current = root
    scene.add(root)

    let stopped = false
    const render = () => {
      if (stopped) return

      // 只有不在动画中时才更新 controls
      if (!isAnimatingRef.current && controls.enabled) {
        controls.update()
      }

      // 更新 HTML 标签位置
      if (poiLabelsRef.current && poiObjectsRef.current) {
        poiObjectsRef.current.forEach((group, index) => {
          const label = poiLabelsRef.current[index]
          if (label && group) {
            // 获取 POI 在屏幕上的位置
            const labelPos = new THREE.Vector3()
            labelPos.copy(group.position)
            labelPos.y += 1.2  // 标签在 POI 上方
            labelPos.project(camera)

            const x = (labelPos.x * 0.5 + 0.5) * container.clientWidth
            const y = (-labelPos.y * 0.5 + 0.5) * container.clientHeight

            // 检查是否在相机前面
            if (labelPos.z < 1) {
              label.style.display = 'block'
              label.style.left = `${x}px`
              label.style.top = `${y}px`
            } else {
              label.style.display = 'none'
            }
          }
        })
      }

      // POI图标动画
      const time = performance.now() * 0.001
      if (poiObjectsRef.current) {
        poiObjectsRef.current.forEach((group, index) => {
          if (group.userData.baseMesh) {
            const breathe = Math.sin(time * 2 + index * 0.5) * 0.1 + 1
            group.userData.baseMesh.scale.setScalar(breathe)
            group.userData.coneMesh.scale.setScalar(breathe)

            if (group.userData.glowMesh) {
              group.userData.glowMesh.rotation.z += 0.01
            }

            const currentActivePoi = activePoiRef.current
            if (currentActivePoi?.id === group.userData.poi.id) {
              group.userData.baseMesh.material.opacity = 0.9 + Math.sin(time * 3) * 0.1
              group.userData.coneMesh.material.opacity = 1.0
            } else {
              group.userData.baseMesh.material.opacity = 0.8
              group.userData.coneMesh.material.opacity = 0.9
            }
          }
        })
      }

      renderer.render(scene, camera)
      requestAnimationFrame(render)
    }
    requestAnimationFrame(render)

    const fitContainer = () => {
      const vv = window.visualViewport
      const w = Math.round((vv?.width ?? window.innerWidth))
      const h = Math.round((vv?.height ?? window.innerHeight))
      container.style.width = `${w}px`
      container.style.height = `${h}px`
    }

    // 更可靠的横屏检测函数
    const checkIsLandscape = () => {
      // 优先使用 screen.orientation API (更可靠)
      if (screen.orientation && screen.orientation.type) {
        return screen.orientation.type.includes('landscape')
      }
      // 其次使用 window.orientation (iOS 兼容)
      if (typeof window.orientation === 'number') {
        return Math.abs(window.orientation) === 90
      }
      // 最后使用尺寸比较
      const w = window.visualViewport?.width ?? window.innerWidth
      const h = window.visualViewport?.height ?? window.innerHeight
      return w > h
    }

    const onResize = () => {
      fitContainer()
      const w = container.clientWidth
      const h = container.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      setIsMobile(window.innerWidth <= 900 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent))
      setIsLandscape(checkIsLandscape())
    }
    window.addEventListener('resize', onResize)
    setIsMobile(window.innerWidth <= 900 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent))
    setIsLandscape(checkIsLandscape())
    fitContainer()
    onResize()

    // 监听屏幕方向变化 - 使用多次延迟检测确保状态正确
    const onOrientation = () => {
      // 立即检测一次
      setIsLandscape(checkIsLandscape())
      fitContainer()
      onResize()
      // iOS 需要额外延迟检测
      const delays = [100, 200, 350, 500]
      delays.forEach(delay => {
        setTimeout(() => {
          setIsLandscape(checkIsLandscape())
          fitContainer()
          onResize()
        }, delay)
      })
    }
    window.addEventListener('orientationchange', onOrientation)
    
    // 使用 screen.orientation API (如果支持)
    if (screen.orientation) {
      screen.orientation.addEventListener('change', onOrientation)
    }
    const onVVResize = () => {
      fitContainer()
      onResize()
    }
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onVVResize)

    const handlePointerMove = (event) => {
      const rect = renderer.domElement.getBoundingClientRect()
      const x = (event.clientX - rect.left) / rect.width
      const y = (event.clientY - rect.top) / rect.height
      pointerRef.current.set(x * 2 - 1, -(y * 2 - 1))
    }
    renderer.domElement.addEventListener('pointermove', handlePointerMove)

      ; (async () => {
        setLoading(true)
        const tryLoad = async (url) => {
          const mesh = new SplatMesh({ url })
          mesh.rotation.x = Math.PI
          splatRef.current = mesh
          root.add(mesh)
        }
        try {
          await tryLoad('./scene.sog')
          setLoading(false)
        } catch {
          try {
            await tryLoad('./scene.ply')
            setLoading(false)
          } catch {
            setError('场景加载失败')
            setLoading(false)
          }
        }
      })()

      ; (async () => {
        try {
          const res = await fetch('./pois.json')
          if (res.ok) {
            const data = await res.json()
            setPois(Array.isArray(data) ? data : [])
          }
        } catch { }
      })()

      ; (async () => {
        try {
          const res = await fetch('./cameras.json')
          if (res.ok) {
            const data = await res.json()
            setCameras(Array.isArray(data) ? data : [])
          }
        } catch { }
      })()

      ; (async () => {
        if (navigator.xr && typeof navigator.xr.isSessionSupported === 'function') {
          try {
            const supported = await navigator.xr.isSessionSupported('immersive-ar')
            setArSupported(!!supported)
          } catch {
            setArSupported(false)
          }
        }
      })()

    return () => {
      stopped = true
      if (animRef.current) {
        cancelAnimationFrame(animRef.current)
        animRef.current = null
      }
      // 清理 HTML 标签
      poiLabelsRef.current.forEach((label) => {
        label?.remove()
      })
      poiLabelsRef.current = []

      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onOrientation)
      if (screen.orientation) {
        screen.orientation.removeEventListener('change', onOrientation)
      }
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', onVVResize)
      renderer.domElement.removeEventListener('pointermove', handlePointerMove)
      if (orientationHandlerRef.current) {
        window.removeEventListener('deviceorientation', orientationHandlerRef.current)
        orientationHandlerRef.current = null
      }
      controls.dispose()
      renderer.dispose()
      container.removeChild(renderer.domElement)
    }
  }, [])

  // 单独处理点击事件
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return

    const handleClick = () => {
      // 动画过程中禁止点击
      if (isAnimatingRef.current) return

      if (!showPoiIcons || !poiObjectsRef.current.length) return

      const camera = cameraRef.current
      if (!camera) return

      raycasterRef.current.setFromCamera(pointerRef.current, camera)

      const allIconMeshes = []
      poiObjectsRef.current.forEach(group => {
        group.traverse((child) => {
          if (child.isMesh) {
            child.userData.poi = group.userData.poi
            allIconMeshes.push(child)
          }
        })
      })

      const intersects = raycasterRef.current.intersectObjects(allIconMeshes, false)
      if (intersects.length > 0) {
        const poi = intersects[0].object.userData.poi
        if (poi) {
          setActivePoi(poi)
          // POI 点击只高亮，不移动相机
        }
      }
    }

    renderer.domElement.addEventListener('click', handleClick)

    return () => {
      renderer.domElement.removeEventListener('click', handleClick)
    }
  }, [showPoiIcons])

  // 创建 POI 对象
  // 注意：POI 添加到 scene 而不是 root，避免被 sceneScale 影响
  useEffect(() => {
    // 等待场景加载完成
    if (!sceneRef.current || loading || !containerRef.current) return

    // 清理旧的 POI 对象
    poiObjectsRef.current.forEach((o) => {
      sceneRef.current?.remove(o)
      o.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose()
          child.material?.dispose()
        }
      })
    })
    poiObjectsRef.current = []

    // 清理旧的 HTML 标签
    poiLabelsRef.current.forEach((label) => {
      label?.remove()
    })
    poiLabelsRef.current = []

    if (!showPoiIcons || pois.length === 0) return

    const poiYOffset = -1.5  // POI 向下偏移量

    console.log('Creating POIs:', pois.length)

    pois.forEach((p) => {
      const poiGroup = new THREE.Group()

      // 底座圆盘
      const baseGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 16)
      const baseMaterial = new THREE.MeshBasicMaterial({
        color: 0x4a90e2,
        transparent: true,
        opacity: 0.8,
        depthTest: true
      })
      const baseMesh = new THREE.Mesh(baseGeometry, baseMaterial)
      baseMesh.position.y = 0.05
      poiGroup.add(baseMesh)

      // 锥形指示器
      const coneGeometry = new THREE.ConeGeometry(0.15, 0.4, 8)
      const coneMaterial = new THREE.MeshBasicMaterial({
        color: 0x4a90e2,
        transparent: true,
        opacity: 0.9,
        depthTest: true
      })
      const coneMesh = new THREE.Mesh(coneGeometry, coneMaterial)
      coneMesh.position.y = 0.3
      poiGroup.add(coneMesh)

      // 发光环
      const glowGeometry = new THREE.RingGeometry(0.35, 0.5, 16)
      const glowMaterial = new THREE.MeshBasicMaterial({
        color: 0x4a90e2,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        depthTest: true
      })
      const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial)
      glowMesh.rotation.x = -Math.PI / 2
      glowMesh.position.y = 0.01
      poiGroup.add(glowMesh)

      const [x, y, z] = p.position || [0, 0, 0]
      poiGroup.position.set(x, y + poiYOffset, z)

      poiGroup.userData.poi = p
      poiGroup.userData.baseMesh = baseMesh
      poiGroup.userData.coneMesh = coneMesh
      poiGroup.userData.glowMesh = glowMesh
      poiGroup.userData.originalScale = 1

      poiObjectsRef.current.push(poiGroup)
      sceneRef.current.add(poiGroup)

      // 创建 HTML 标签
      const label = document.createElement('div')
      label.className = 'poi-label'
      label.textContent = p.name || 'POI'
      label.style.cssText = `
        position: absolute;
        transform: translate(-50%, -100%);
        padding: 6px 12px;
        background: rgba(0, 0, 0, 0.75);
        color: white;
        font-size: 14px;
        font-weight: bold;
        border-radius: 6px;
        white-space: nowrap;
        pointer-events: none;
        z-index: 100;
        text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        border: 1px solid rgba(74, 144, 226, 0.5);
      `
      containerRef.current.appendChild(label)
      poiLabelsRef.current.push(label)

      console.log('Added POI:', p.name, 'at', x, y + poiYOffset, z)
    })
  }, [pois, showPoiIcons, loading])

  // 单独处理 activePoi 变化时的颜色更新
  useEffect(() => {
    poiObjectsRef.current.forEach((group) => {
      const isActive = activePoi?.id === group.userData.poi.id
      const color = isActive ? 0xff6b35 : 0x4a90e2

      if (group.userData.baseMesh) {
        group.userData.baseMesh.material.color.setHex(color)
      }
      if (group.userData.coneMesh) {
        group.userData.coneMesh.material.color.setHex(color)
      }
      if (group.userData.glowMesh) {
        group.userData.glowMesh.material.color.setHex(color)
      }
    })
  }, [activePoi])

  // 处理初始相机
  useEffect(() => {
    if (loading || cameras.length === 0) return

    const initialCamera = cameras.find(c => c.isInitial)
    if (initialCamera && !activePoiRef.current) {
      const timer = setTimeout(() => {
        setActiveCamera(initialCamera)
        moveToCamera(initialCamera, true)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [cameras, loading, moveToCamera])

  useEffect(() => {
    if (!rootRef.current) return
    rootRef.current.scale.set(sceneScale, sceneScale, sceneScale)
  }, [sceneScale])

  // 应用3DGS场景偏移（只偏移SplatMesh，不影响POI和相机）
  useEffect(() => {
    if (!splatRef.current) return
    splatRef.current.position.set(splatOffset[0], splatOffset[1], splatOffset[2])
  }, [splatOffset])

  const startAR = async () => {
    if (!arSupported || !rendererRef.current) return
    try {
      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hit-test']
      })
      const renderer = rendererRef.current
      renderer.xr.enabled = true
      await renderer.xr.setSession(session)
      setArActive(true)
    } catch { }
  }

  const stopAR = async () => {
    if (!rendererRef.current || !rendererRef.current.xr || !rendererRef.current.xr.getSession()) {
      setArActive(false)
      return
    }
    try {
      await rendererRef.current.xr.getSession().end()
    } catch { }
    setArActive(false)
  }

  const startOrientation = async () => {
    if (orientationActive) return

    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return

    // iOS 13+ 需要请求权限，必须由用户手势触发
    // 需要同时请求 DeviceMotionEvent 和 DeviceOrientationEvent 权限

    // 请求 DeviceMotionEvent 权限
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        console.log('请求 iOS DeviceMotionEvent 权限...')
        const motionPermission = await DeviceMotionEvent.requestPermission()
        console.log('DeviceMotionEvent 权限结果:', motionPermission)

        if (motionPermission !== 'granted') {
          setToast('❌ 需要允许访问"动态与方向"权限')
          setTimeout(() => setToast(''), 5000)
          return
        }
      } catch (err) {
        console.error('请求 DeviceMotionEvent 权限失败:', err)
        setToast('❌ 无法获取动态权限: ' + err.message)
        setTimeout(() => setToast(''), 5000)
        return
      }
    }

    // 请求 DeviceOrientationEvent 权限
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        console.log('请求 iOS DeviceOrientationEvent 权限...')
        const orientationPermission = await DeviceOrientationEvent.requestPermission()
        console.log('DeviceOrientationEvent 权限结果:', orientationPermission)

        if (orientationPermission !== 'granted') {
          setToast('❌ 需要允许访问"方向"权限')
          setTimeout(() => setToast(''), 5000)
          return
        }
      } catch (err) {
        console.error('请求 DeviceOrientationEvent 权限失败:', err)
        setToast('❌ 无法获取方向权限: ' + err.message)
        setTimeout(() => setToast(''), 5000)
        return
      }
    }

    // 检测是否支持陀螺仪
    let hasGyro = false
    const testHandler = (e) => {
      if (e.alpha !== null || e.beta !== null || e.gamma !== null) {
        hasGyro = true
      }
    }

    window.addEventListener('deviceorientation', testHandler)

    // 等待一小段时间检测
    await new Promise(resolve => setTimeout(resolve, 500))
    window.removeEventListener('deviceorientation', testHandler)

    if (!hasGyro) {
      setToast('⚠️ 未检测到陀螺仪数据，请确保设备支持')
      setTimeout(() => setToast(''), 4000)
      // 继续尝试，有些设备可能需要更长时间
    }

    // 禁用 OrbitControls
    controls.enabled = false

    // 保存初始相机位置
    const initialPosition = camera.position.clone()

    // 初始方向偏移（用于校准）
    let initialAlpha = null

const handler = (event) => {
  if (event.alpha === null) return
  
  let alpha = event.alpha || 0
  let beta = event.beta || 0
  let gamma = event.gamma || 0
  
  // --- 1. Alpha (Yaw) ---
  if (initialAlpha === null) {
    initialAlpha = alpha
  }
  let relativeAlpha = alpha - initialAlpha
  let yaw = THREE.MathUtils.degToRad(relativeAlpha)
  
  // --- 2. Pitch (Gamma) & Roll (Beta) ---
  let pitch = 0
  let roll = 0

  if (gamma > 0) {
    // 情况：249, -168, 68 (朝上看)
    pitch = THREE.MathUtils.degToRad(90 - gamma)
    
    // 关键修正：既然你说此时 Roll 是对的，我们观察此时 Beta 是 -168
    // 我们需要把 Beta 映射回正常的平滑区间
    // 此时 Yaw 已经由传感器跳变处理了一部分，我们根据需要补齐 180 度
    yaw += Math.PI
    
    // 既然此时 Roll 对了，直接使用 -betaRad (或根据测试取反)
    // 注意：-168度其实相当于 12度 倒过来。
    roll = THREE.MathUtils.degToRad(beta) + Math.PI
    
  } else {
    // 情况：96, -18, -82 (朝下看)
    pitch = THREE.MathUtils.degToRad(-(gamma + 90))
    
    // 你说此时 Roll 是反的，所以我们给 betaRad 加负号
    roll = -THREE.MathUtils.degToRad(beta)
  }

  // --- 3. 应用 ---
  // 使用 YXZ 顺序
  const euler = new THREE.Euler(pitch, yaw, roll, 'YXZ')
  camera.quaternion.setFromEuler(euler)
}
    window.addEventListener('deviceorientation', handler, true)
    orientationHandlerRef.current = handler
    setOrientationActive(true)
    setToast('✅ 陀螺仪已启用，转动手机查看四周')
    setTimeout(() => setToast(''), 3000)
  }

  const stopOrientation = () => {
    if (orientationHandlerRef.current) {
      window.removeEventListener('deviceorientation', orientationHandlerRef.current, true)
      orientationHandlerRef.current = null
    }
    setOrientationActive(false)

    // 恢复 OrbitControls
    if (controlsRef.current) {
      controlsRef.current.enabled = true
    }
  }

  const handleCameraClick = useCallback((cam) => {
    if (isAnimatingRef.current) return
    setActiveCamera(cam)
    moveToCamera(cam)
  }, [moveToCamera])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div ref={containerRef} style={{ flex: 1, position: 'relative', background: '#000' }}>
        {/* 顶部 Toast 提示 */}
        {toast && (
          <div
            style={{
              position: 'absolute',
              top: 20,
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '12px 24px',
              background: 'rgba(0, 0, 0, 0.85)',
              color: '#fff',
              fontSize: 15,
              fontWeight: 'bold',
              borderRadius: 10,
              zIndex: 9999,
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              border: '1px solid rgba(255,255,255,0.2)',
              maxWidth: '80%',
              textAlign: 'center',
              animation: 'fadeIn 0.3s ease'
            }}
          >
            {toast}
          </div>
        )}

        {loading && (
          <div style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
            加载中…
          </div>
        )}
        {error && (
          <div style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f55' }}>
            {error}
          </div>
        )}
        {!isLandscape && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.9)',
              color: '#fff',
              fontSize: 18,
              zIndex: 9999,
              padding: 30
            }}
          >
            <div style={{
              fontSize: 60,
              marginBottom: 20,
              animation: 'rotate90 1.5s ease-in-out infinite'
            }}>
              📱
            </div>
            <div style={{
              fontWeight: 'bold',
              fontSize: 20,
              marginBottom: 10,
              textAlign: 'center'
            }}>
              请旋转手机到横屏模式
            </div>
            <div style={{
              opacity: 0.7,
              fontSize: 14,
              textAlign: 'center'
            }}>
              横屏浏览可获得最佳体验
            </div>
            <style>{`
              @keyframes rotate90 {
                0%, 100% { transform: rotate(0deg); }
                50% { transform: rotate(90deg); }
              }
            `}</style>
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            bottom: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: 10,
            width: isMobile ? 180 : 220,
            background: 'rgba(20,20,20,0.7)',
            borderRadius: 10,
            color: '#fff',
            overflowY: 'auto',
            zIndex: 10,
            pointerEvents: 'auto'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 16, fontWeight: 'bold' }}>场景控制</div>
            <button
              onClick={() => setShowPoiIcons(!showPoiIcons)}
              style={{
                padding: '4px 8px',
                fontSize: 12,
                background: showPoiIcons ? 'rgba(74, 144, 226, 0.8)' : 'rgba(255, 255, 255, 0.2)',
                border: 'none',
                borderRadius: 4,
                color: '#fff',
                cursor: 'pointer',
                transition: 'background 0.2s ease'
              }}
            >
              {showPoiIcons ? '隐藏标记' : '显示标记'}
            </button>
          </div>

          <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 8, borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 10 }}>镜头位置</div>
          <div style={{ flex: 1, overflowY: 'auto', marginBottom: 10 }}>
            {cameras.map((cam) => (
              <div
                key={cam.id}
                onClick={() => handleCameraClick(cam)}
                style={{
                  padding: '8px 12px',
                  marginBottom: 4,
                  background: activeCamera?.id === cam.id ? 'rgba(74, 144, 226, 0.3)' : 'rgba(255,255,255,0.1)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                  transition: 'background 0.2s ease',
                  borderLeft: activeCamera?.id === cam.id ? '3px solid #4a90e2' : '3px solid transparent'
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'rgba(255,255,255,0.3)'
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = activeCamera?.id === cam.id ? 'rgba(74, 144, 226, 0.3)' : 'rgba(255,255,255,0.1)'
                }}
              >
                <div style={{ fontWeight: 'bold' }}>{cam.name}</div>
                {cam.description && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{cam.description}</div>}
              </div>
            ))}
          </div>

          {arSupported && !arActive && (
            <button onClick={startAR} style={{ padding: '12px 14px', fontSize: 14, background: 'rgba(74, 144, 226, 0.8)', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>
              启用 AR
            </button>
          )}
          {arActive && (
            <button onClick={stopAR} style={{ padding: '12px 14px', fontSize: 14, background: 'rgba(255, 107, 53, 0.8)', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>
              退出 AR
            </button>
          )}

          {!orientationActive ? (
            <button
              onClick={startOrientation}
              style={{
                padding: '12px 14px',
                fontSize: 14,
                background: 'rgba(74, 144, 226, 0.8)',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8
              }}
            >
              <span>📱</span> 启用陀螺仪
            </button>
          ) : (
            <button
              onClick={stopOrientation}
              style={{
                padding: '12px 14px',
                fontSize: 14,
                background: 'rgba(255, 107, 53, 0.8)',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                cursor: 'pointer'
              }}
            >
              退出陀螺仪
            </button>
          )}

          {/* 
          <div style={{ fontSize: 14, fontWeight: 'bold', marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 10 }}>
            场景偏移
          </div>
          {['X', 'Y', 'Z'].map((axis, index) => (
            <div key={axis} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, width: 20 }}>{axis}:</span>
              <input
                type="range"
                min="-10"
                max="10"
                step="0.1"
                value={splatOffset[index]}
                onChange={(e) => {
                  const newOffset = [...splatOffset]
                  newOffset[index] = parseFloat(e.target.value)
                  setSplatOffset(newOffset)
                }}
                style={{ flex: 1, cursor: 'pointer' }}
              />
              <span style={{ fontSize: 11, width: 35, textAlign: 'right' }}>{splatOffset[index].toFixed(1)}</span>
            </div>
          ))}
          <button
            onClick={() => setSplatOffset([0, 0, 0])}
            style={{
              padding: '6px 10px',
              fontSize: 12,
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              borderRadius: 4,
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            重置偏移
          </button>
3DGS场景偏移控制 */}
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 'auto', textAlign: 'center' }}>
            {orientationActive ? '🔄 陀螺仪已启用' : (activeCamera ? `📍 ${activeCamera.name}` : '选择镜头位置')}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SplatViewer