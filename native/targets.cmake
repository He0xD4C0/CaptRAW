find_package(nlohmann_json REQUIRED)
target_sources(art_engine PRIVATE "${CAPTRAW_SOURCE_DIR}/grading.cc" "${CAPTRAW_SOURCE_DIR}/preview-crop.cc" "${CAPTRAW_SOURCE_DIR}/geometry-map.cc" "${CAPTRAW_SOURCE_DIR}/geometry-field.cc")
target_include_directories(art_engine PRIVATE "${CMAKE_SOURCE_DIR}/src" "${CAPTRAW_SOURCE_DIR}")
include_directories(${GTKMM_INCLUDE_DIRS} ${GTK_INCLUDE_DIRS} ${CAIROMM_INCLUDE_DIRS}
  ${GIOMM_INCLUDE_DIRS} ${GIO_INCLUDE_DIRS} ${GLIBMM_INCLUDE_DIRS} ${GLIB2_INCLUDE_DIRS}
  ${SIGC_INCLUDE_DIRS} ${EXIV2_INCLUDE_DIRS} ${LCMS_INCLUDE_DIRS} ${FFTW3F_INCLUDE_DIRS}
  ${PNG_INCLUDE_DIRS} ${LENSFUN_INCLUDE_DIRS}
  "${CMAKE_SOURCE_DIR}/src" "${CMAKE_BINARY_DIR}/src/utils" "${CAPTRAW_SOURCE_DIR}")
link_directories(${GTKMM_LIBRARY_DIRS} ${GIOMM_LIBRARY_DIRS} ${GIO_LIBRARY_DIRS}
  ${CAIROMM_LIBRARY_DIRS} ${GLIBMM_LIBRARY_DIRS} ${GLIB2_LIBRARY_DIRS})
set(CAPTRAW_SUPPORT
  "${CMAKE_SOURCE_DIR}/src/gui/alignedmalloc.cc"
  "${CMAKE_SOURCE_DIR}/src/gui/edit.cc"
  "${CMAKE_SOURCE_DIR}/src/gui/options.cc"
  "${CMAKE_SOURCE_DIR}/src/gui/paramsedited.cc"
  "${CMAKE_SOURCE_DIR}/src/gui/exiffiltersettings.cc")
add_library(captraw-core STATIC ${CAPTRAW_SUPPORT}
  "${CAPTRAW_SOURCE_DIR}/core.cc" "${CAPTRAW_SOURCE_DIR}/recipe.cc" "${CAPTRAW_SOURCE_DIR}/white-balance.cc"
  "${CAPTRAW_SOURCE_DIR}/input-profile.cc")
target_compile_features(captraw-core PUBLIC cxx_std_17)
target_link_libraries(captraw-core PUBLIC art_engine art_utils nlohmann_json::nlohmann_json
  ${CAIROMM_LIBRARIES} ${GIOMM_LIBRARIES} ${GIO_LIBRARIES} ${GTKMM_LIBRARIES}
  ${RSVG_LIBRARIES} ${EXIV2_LIBRARIES})
add_executable(captraw-engine "${CAPTRAW_SOURCE_DIR}/worker.cc")
target_compile_features(captraw-engine PUBLIC cxx_std_17)
target_link_libraries(captraw-engine PRIVATE captraw-core)
add_executable(captraw-wb-probe EXCLUDE_FROM_ALL "${CAPTRAW_SOURCE_DIR}/../tests/white-balance-probe.cc")
target_link_libraries(captraw-wb-probe PRIVATE captraw-core)
add_executable(captraw-geometry-probe EXCLUDE_FROM_ALL "${CAPTRAW_SOURCE_DIR}/../tests/geometry-probe.cc")
target_link_libraries(captraw-geometry-probe PRIVATE captraw-core)
add_executable(captraw-auto-crop-probe EXCLUDE_FROM_ALL "${CAPTRAW_SOURCE_DIR}/../tests/auto-crop-probe.cc")
target_link_libraries(captraw-auto-crop-probe PRIVATE captraw-core)
add_executable(captraw-mask-geometry-probe EXCLUDE_FROM_ALL "${CAPTRAW_SOURCE_DIR}/../tests/mask-geometry-probe.cc")
target_link_libraries(captraw-mask-geometry-probe PRIVATE captraw-core)
add_executable(captraw-art-reference ${CAPTRAW_SUPPORT}
  "${CMAKE_SOURCE_DIR}/src/gui/main-cli.cc"
  "${CMAKE_SOURCE_DIR}/src/gui/fastexport.cc"
  "${CMAKE_SOURCE_DIR}/src/gui/makeicc.cc")
target_link_libraries(captraw-art-reference PRIVATE art_engine art_utils
  ${CAIROMM_LIBRARIES} ${GIOMM_LIBRARIES} ${GIO_LIBRARIES} ${GTKMM_LIBRARIES}
  ${RSVG_LIBRARIES} ${EXIV2_LIBRARIES})
if(APPLE)
  target_link_libraries(captraw-wb-probe PRIVATE "-framework Foundation")
  target_link_libraries(captraw-geometry-probe PRIVATE "-framework Foundation")
  target_link_libraries(captraw-auto-crop-probe PRIVATE "-framework Foundation")
  target_link_libraries(captraw-mask-geometry-probe PRIVATE "-framework Foundation")
  target_link_libraries(captraw-engine PRIVATE "-framework Foundation")
  target_link_libraries(captraw-art-reference PRIVATE "-framework Foundation")
endif()
