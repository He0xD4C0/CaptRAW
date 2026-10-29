# Use the pinned SDK's mature photo handlers, with no media/plugin runtime.
set(XMP_PHOTO_FORMATS IPTC_Support PSIR_FileWriter PSIR_MemoryReader
  ReconcileIPTC ReconcileLegacy ReconcileTIFF Reconcile_Impl
  TIFF_FileWriter TIFF_MemoryReader TIFF_Support TimeConversionUtils
  ID3_Support ISOBaseMedia_Support)
set(XMP_FILE_SOURCES)
foreach(name IN LISTS XMP_PHOTO_FORMATS)
  list(APPEND XMP_FILE_SOURCES "${SDK}/XMPFiles/source/FormatSupport/${name}.cpp")
endforeach()
foreach(name Basic JPEG PSD TIFF GIF)
  list(APPEND XMP_FILE_SOURCES "${SDK}/XMPFiles/source/FileHandlers/${name}_Handler.cpp")
endforeach()
foreach(name HandlerRegistry WXMPFiles XMPFiles XMPFiles_Impl)
  list(APPEND XMP_FILE_SOURCES "${SDK}/XMPFiles/source/${name}.cpp")
endforeach()
foreach(name XIO IOUtils XMP_ProgressTracker XMPFiles_IO SafeStringAPIs PerfUtils)
  list(APPEND XMP_FILE_SOURCES "${SDK}/source/${name}.cpp")
endforeach()
if(WIN32)
  list(APPEND XMP_FILE_SOURCES "${SDK}/source/Host_IO-Win.cpp")
else()
  list(APPEND XMP_FILE_SOURCES "${SDK}/source/Host_IO-POSIX.cpp")
endif()
add_library(xmp-files STATIC ${XMP_FILE_SOURCES})
target_link_libraries(xmp-files PUBLIC xmp)
if(APPLE)
  target_link_libraries(xmp-files PUBLIC "-framework CoreServices")
endif()
target_compile_definitions(xmp-files PUBLIC XMP_INCLUDE_XMPFILES=1 PRIVATE
  EnablePhotoHandlers=1 EnableDynamicMediaHandlers=0 EnableMiscHandlers=0
  EnablePluginManager=0 EnablePacketScanning=0 EnableGenericHandling=0
  BUILDING_XMPFILES_LIB=1 BUILDING_XMPFILES_AS_STATIC=1)
target_link_libraries(captraw-xmp PRIVATE xmp-files)
